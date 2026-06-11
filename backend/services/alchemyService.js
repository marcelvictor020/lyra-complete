import axios from 'axios';

const DEFAULT_ALCHEMY_KEY = process.env.ALCHEMY_API_KEY || 'wcxam6IKayZFOfrN9RShw';
const DEFAULT_NETWORK = process.env.ALCHEMY_NETWORK || 'mantle-mainnet';

const NETWORK_RPC_BASE = {
  'mantle-mainnet': 'https://mantle-mainnet.g.alchemy.com/v2',
  'eth-mainnet': 'https://eth-mainnet.g.alchemy.com/v2',
  'base-mainnet': 'https://base-mainnet.g.alchemy.com/v2',
  'arbitrum-mainnet': 'https://arb-mainnet.g.alchemy.com/v2',
  'optimism-mainnet': 'https://opt-mainnet.g.alchemy.com/v2',
  'polygon-mainnet': 'https://polygon-mainnet.g.alchemy.com/v2'
};

function hexToBigInt(value) {
  if (!value || value === '0x' || value === '0x0') return 0n;
  return BigInt(value);
}

function formatUnits(rawValue, decimals = 18) {
  const raw = typeof rawValue === 'bigint' ? rawValue : BigInt(String(rawValue || '0'));
  const places = Number(decimals || 0);
  if (places <= 0) return raw.toString();

  const negative = raw < 0n;
  const absolute = negative ? raw * -1n : raw;
  const divisor = 10n ** BigInt(places);
  const whole = absolute / divisor;
  const fraction = absolute % divisor;
  const fractionText = fraction.toString().padStart(places, '0').replace(/0+$/, '');
  const text = fractionText ? `${whole}.${fractionText}` : whole.toString();
  return negative ? `-${text}` : text;
}

function normalizeTokenMetadata(contractAddress, metadata = {}) {
  return {
    contractAddress,
    symbol: metadata.symbol || 'UNKNOWN',
    name: metadata.name || metadata.symbol || 'Unknown token',
    decimals: Number(metadata.decimals ?? 18),
    logo: metadata.logo || null
  };
}

export class AlchemyService {
  constructor(options = {}) {
    this.apiKey = options.apiKey || DEFAULT_ALCHEMY_KEY;
    this.network = options.network || DEFAULT_NETWORK;
    const base = options.rpcBase || NETWORK_RPC_BASE[this.network] || NETWORK_RPC_BASE['mantle-mainnet'];
    this.rpcUrl = options.rpcUrl || `${base}/${this.apiKey}`;
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async rpc(method, params = []) {
    if (!this.isConfigured()) {
      throw new Error('ALCHEMY_API_KEY is not configured');
    }

    let response;
    try {
      response = await axios.post(
        this.rpcUrl,
        {
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params
        },
        {
          headers: { 'Content-Type': 'application/json' },
          proxy: false,
          timeout: 15000
        }
      );
    } catch (error) {
      const detail = error.response?.data?.error?.message || error.message;
      throw new Error(`Alchemy ${method} failed: ${detail}`);
    }

    if (response.data?.error) {
      throw new Error(`Alchemy ${method} failed: ${response.data.error.message || 'Unknown error'}`);
    }

    return response.data?.result;
  }

  async getNativeBalance(address) {
    const result = await this.rpc('eth_getBalance', [address, 'latest']);
    const raw = hexToBigInt(result);
    return {
      symbol: this.network === 'mantle-mainnet' ? 'MNT' : 'ETH',
      name: this.network === 'mantle-mainnet' ? 'Mantle' : 'Ethereum',
      contractAddress: null,
      decimals: 18,
      raw: raw.toString(),
      formatted: formatUnits(raw, 18)
    };
  }

  async getTokenMetadata(contractAddress) {
    try {
      const result = await this.rpc('alchemy_getTokenMetadata', [contractAddress]);
      return normalizeTokenMetadata(contractAddress, result);
    } catch {
      return normalizeTokenMetadata(contractAddress, {});
    }
  }

  async getTokenHoldings(address) {
    let result;
    try {
      result = await this.rpc('alchemy_getTokenBalances', [address, 'erc20']);
    } catch (error) {
      if (String(error.message || '').includes('EAPIs not enabled')) {
        return [];
      }
      throw error;
    }
    const balances = Array.isArray(result?.tokenBalances) ? result.tokenBalances : [];
    const funded = balances.filter((item) => hexToBigInt(item.tokenBalance) > 0n);

    const withMetadata = await Promise.all(
      funded.map(async (item) => {
        const metadata = await this.getTokenMetadata(item.contractAddress);
        const decimals = Number(metadata.decimals ?? 18);
        return {
          ...metadata,
          raw: hexToBigInt(item.tokenBalance).toString(),
          formatted: formatUnits(hexToBigInt(item.tokenBalance), decimals)
        };
      })
    );

    return withMetadata;
  }

  async getWalletBalances(address) {
    const [nativeBalance, tokenHoldings] = await Promise.all([
      this.getNativeBalance(address),
      this.getTokenHoldings(address)
    ]);

    return {
      network: this.network,
      nativeBalance,
      tokenHoldings
    };
  }

  async getRecentTransactions(address, maxCount = 25) {
    const baseParams = {
      fromBlock: '0x0',
      toBlock: 'latest',
      category: ['external', 'internal', 'erc20'],
      withMetadata: true,
      excludeZeroValue: false,
      maxCount: `0x${maxCount.toString(16)}`
    };

    let outbound;
    let inbound;
    try {
      [outbound, inbound] = await Promise.all([
        this.rpc('alchemy_getAssetTransfers', [{ ...baseParams, fromAddress: address }]),
        this.rpc('alchemy_getAssetTransfers', [{ ...baseParams, toAddress: address }])
      ]);
    } catch (error) {
      if (String(error.message || '').includes('EAPIs not enabled')) {
        const txCount = await this.rpc('eth_getTransactionCount', [address, 'latest']).catch(() => '0x0');
        return [{
          hash: null,
          category: 'transaction-count',
          asset: null,
          value: null,
          from: address,
          to: null,
          blockNumber: null,
          timestamp: null,
          count: Number.parseInt(txCount || '0x0', 16)
        }].filter((item) => item.count > 0);
      }
      throw error;
    }

    const combined = [...(outbound?.transfers || []), ...(inbound?.transfers || [])];
    const unique = new Map();

    for (const transfer of combined) {
      const key = [
        transfer.hash,
        transfer.category,
        transfer.asset,
        transfer.value,
        transfer.from,
        transfer.to
      ].join(':');

      if (!unique.has(key)) {
        unique.set(key, {
          hash: transfer.hash,
          category: transfer.category || 'external',
          asset: transfer.asset || transfer.rawContract?.address || 'UNKNOWN',
          value: transfer.value ?? null,
          from: transfer.from || null,
          to: transfer.to || null,
          blockNumber: transfer.blockNum ? Number.parseInt(transfer.blockNum, 16) : null,
          timestamp: transfer.metadata?.blockTimestamp || null
        });
      }
    }

    return Array.from(unique.values())
      .sort((a, b) => (b.blockNumber || 0) - (a.blockNumber || 0))
      .slice(0, maxCount);
  }

  async getOldestTransactionTimestamp(address) {
    const baseParams = {
      fromBlock: '0x0',
      toBlock: 'latest',
      category: ['external', 'internal', 'erc20'],
      withMetadata: true,
      excludeZeroValue: false,
      maxCount: '0x1',
      order: 'asc'
    };

    let outbound;
    let inbound;
    try {
      [outbound, inbound] = await Promise.all([
        this.rpc('alchemy_getAssetTransfers', [{ ...baseParams, fromAddress: address }]),
        this.rpc('alchemy_getAssetTransfers', [{ ...baseParams, toAddress: address }])
      ]);
    } catch (error) {
      if (String(error.message || '').includes('EAPIs not enabled')) {
        return null;
      }
      throw error;
    }

    const timestamps = [...(outbound?.transfers || []), ...(inbound?.transfers || [])]
      .map((transfer) => transfer?.metadata?.blockTimestamp || null)
      .filter(Boolean)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    return timestamps[0] || null;
  }
}

export default AlchemyService;
