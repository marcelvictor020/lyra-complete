import WalletHistory from '../../src/history.js';

const DEFAULT_COVALENT_KEY =
  process.env.GOLDRUSH_API_KEY ||
  process.env.COVALENT_API_KEY ||
  'cqt_rQJ8DftWpfFpPM6btPj3cDGFDpWg';

const CHAIN_MATRIX = [
  { id: 'mantle-mainnet', label: 'Mantle' },
  { id: 'eth-mainnet', label: 'Ethereum' },
  { id: 'base-mainnet', label: 'Base' },
  { id: 'arbitrum-mainnet', label: 'Arbitrum' },
  { id: 'optimism-mainnet', label: 'Optimism' },
  { id: 'polygon-mainnet', label: 'Polygon' }
];

const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'USDB', 'USDM', 'FDUSD', 'TUSD']);

function sumValues(items = []) {
  return items.reduce((total, item) => total + Number(item.value || 0), 0);
}

export class CovalentService {
  constructor(options = {}) {
    this.apiKey = options.apiKey || DEFAULT_COVALENT_KEY;
    this.chains = options.chains || CHAIN_MATRIX;
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  createReader(chainId) {
    return new WalletHistory({
      apiKey: this.apiKey,
      chainName: chainId
    });
  }

  async getPortfolio(address) {
    if (!this.isConfigured()) {
      throw new Error('COVALENT_API_KEY is not configured');
    }

    const results = await Promise.all(
      this.chains.map(async (chain) => {
        try {
          const reader = this.createReader(chain.id);
          const balances = await reader.getTokenBalances(address);
          return {
            chainId: chain.id,
            chainLabel: chain.label,
            balances,
            totalValue: sumValues(balances)
          };
        } catch (error) {
          return {
            chainId: chain.id,
            chainLabel: chain.label,
            balances: [],
            totalValue: 0,
            error: error.message
          };
        }
      })
    );

    return results.filter((entry) => entry.totalValue > 0 || entry.balances.length > 0);
  }

  async getChainActivity(address) {
    if (!this.isConfigured()) {
      throw new Error('COVALENT_API_KEY is not configured');
    }

    const results = await Promise.all(
      this.chains.map(async (chain) => {
        try {
          const reader = this.createReader(chain.id);
          const transactions = await reader.getRecentTransactions(address, 20);
          return {
            chainId: chain.id,
            chainLabel: chain.label,
            transactionCount: transactions.length,
            latestActivityAt: transactions[0]?.blockSignedAt || null,
            sampleTransactions: transactions.slice(0, 5)
          };
        } catch (error) {
          return {
            chainId: chain.id,
            chainLabel: chain.label,
            transactionCount: 0,
            latestActivityAt: null,
            sampleTransactions: [],
            error: error.message
          };
        }
      })
    );

    return results.filter((entry) => entry.transactionCount > 0);
  }

  async getTokenDistribution(address) {
    const portfolio = await this.getPortfolio(address);
    const aggregated = new Map();

    for (const chain of portfolio) {
      for (const balance of chain.balances) {
        const key = balance.address || balance.symbol;
        const existing = aggregated.get(key) || {
          symbol: balance.symbol,
          name: balance.name,
          address: balance.address,
          valueUsd: 0,
          chains: new Set()
        };

        existing.valueUsd += Number(balance.value || 0);
        existing.chains.add(chain.chainLabel);
        aggregated.set(key, existing);
      }
    }

    const holdings = Array.from(aggregated.values())
      .map((item) => ({
        ...item,
        chains: Array.from(item.chains)
      }))
      .sort((a, b) => b.valueUsd - a.valueUsd);

    const totalValueUsd = holdings.reduce((total, item) => total + item.valueUsd, 0);
    const stablecoins = holdings.filter((item) => STABLECOINS.has(String(item.symbol || '').toUpperCase()));
    const stablecoinValueUsd = stablecoins.reduce((total, item) => total + item.valueUsd, 0);

    return {
      totalValueUsd,
      holdings,
      stablecoins,
      stablecoinValueUsd
    };
  }
}

export default CovalentService;
