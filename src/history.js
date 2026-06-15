import axios from 'axios';

const GOLDRUSH_API = 'https://api.covalenthq.com/v1';
const DEFAULT_CHAIN = 'mantle-mainnet';

function compactAddress(address = '') {
  if (!address || address.length < 12) return address || '--';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function normalizeProtocolName(contract = {}) {
  const name = contract.contract_name || contract.name || contract.to_address_label || contract.from_address_label;
  if (name) return name;
  return compactAddress(contract.to_address || contract.from_address || contract.address);
}

function formatTokenAmount(raw = '0', decimals = 0) {
  const value = String(raw || '0');
  const places = Number(decimals || 0);
  if (!places) return value;

  const padded = value.padStart(places + 1, '0');
  const whole = padded.slice(0, -places) || '0';
  const fraction = padded.slice(-places).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function titleCase(value = '') {
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export class WalletHistory {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.GOLDRUSH_API_KEY || process.env.COVALENT_API_KEY;
    this.chainName = options.chainName || process.env.COVALENT_CHAIN || DEFAULT_CHAIN;
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async request(path, params = {}) {
    if (!this.isConfigured()) {
      throw new Error('COVALENT_API_KEY is not configured');
    }

    let response;
    try {
      response = await axios.get(`${GOLDRUSH_API}/${this.chainName}${path}`, {
        params,
        headers: {
          Authorization: `Bearer ${this.apiKey}`
        },
        proxy: false,
        timeout: 12000
      });
    } catch (error) {
      const detail = error.response?.data?.error_message
        || error.response?.data?.message
        || error.response?.data?.error
        || error.message;
      throw new Error(`GoldRush ${this.chainName}${path} failed: ${detail}`);
    }

    if (response.data?.error) {
      throw new Error(response.data.error_message || 'GoldRush request failed');
    }

    return response.data?.data || response.data;
  }

  async getTokenBalances(walletAddress) {
    const data = await this.request(`/address/${walletAddress}/balances_v2/`, {
      nft: false
    });

    const items = data?.items || [];
    return items
      .map((item) => {
        const decimals = Number(item.contract_decimals || 0);
        const raw = item.balance || '0';
        const formatted = formatTokenAmount(raw, decimals);
        const value = Number(item.quote || 0);

        return {
          symbol: item.contract_ticker_symbol || 'UNKNOWN',
          name: item.contract_name || item.contract_ticker_symbol || 'Unknown Token',
          address: item.contract_address,
          logoUrl: item.logo_url || null,
          raw,
          formatted,
          decimals,
          price: item.quote_rate || null,
          value,
          allocationPercent: 0
        };
      })
      .filter((asset) => Number(asset.value) > 0 || Number(asset.formatted) > 0)
      .sort((a, b) => b.value - a.value);
  }

  async getRecentTransactions(walletAddress, pageSize = 10) {
    const data = await this.request(`/address/${walletAddress}/transactions_v3/`);

    const items = data?.items || [];
    return items.slice(0, pageSize).map((tx) => {
      const events = (tx.log_events || []).slice(0, 8).map((event) => ({
        name: event.decoded?.name || null,
        senderName: event.sender_name || null,
        senderAddress: event.sender_address || null,
        contractName: event.sender_contract_ticker_symbol || null
      }));
      const firstNamedEvent = events.find((event) => event.senderName || event.name || event.contractName);
      const summary = tx.method
        ? titleCase(tx.method)
        : firstNamedEvent?.name || firstNamedEvent?.senderName || firstNamedEvent?.contractName || 'Transaction';

      return {
        hash: tx.tx_hash,
        blockSignedAt: tx.block_signed_at,
        successful: tx.successful,
        from: tx.from_address,
        to: tx.to_address,
        toLabel: tx.to_address_label || null,
        fromLabel: tx.from_address_label || null,
        valueQuote: Number(tx.value_quote || 0),
        gasQuote: Number(tx.gas_quote || 0),
        prettyValue: tx.pretty_value_quote || null,
        method: tx.method || null,
        events,
        summary
      };
    });
  }

  summarizeInteractions(transactions = [], walletAddress = '') {
    const counts = new Map();
    const wallet = walletAddress.toLowerCase();

    for (const tx of transactions) {
      const namedEvent = tx.events?.find((event) => event.senderName || event.contractName);
      const counterparty = tx.to?.toLowerCase() === wallet ? tx.from : tx.to;
      const key = tx.toLabel
        || namedEvent?.senderName
        || namedEvent?.contractName
        || (tx.method ? titleCase(tx.method) : null)
        || tx.summary
        || compactAddress(counterparty);
      if (!key || key === '--') continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));
  }

  buildRiskSignal(balances = []) {
    const total = balances.reduce((sum, asset) => sum + Number(asset.value || 0), 0);
    if (total <= 0) return 'No funded positions';
    if (balances.length < 2) return 'Additional history required';

    const top = balances[0];
    const topShare = top ? (Number(top.value || 0) / total) * 100 : 0;
    if (topShare >= 70) return `Visible concentration in ${top.symbol}`;
    return 'Needs deeper review';
  }

  async buildWalletIntelligence(walletAddress) {
    const [balances, transactions] = await Promise.all([
      this.getTokenBalances(walletAddress),
      this.getRecentTransactions(walletAddress, 10)
    ]);

    const totalValue = balances.reduce((sum, asset) => sum + Number(asset.value || 0), 0);
    const normalizedBalances = balances.map((asset) => ({
      ...asset,
      allocationPercent: totalValue > 0 ? (Number(asset.value || 0) / totalValue) * 100 : 0
    }));

    const topHolding = normalizedBalances[0] || null;
    const interactions = this.summarizeInteractions(transactions, walletAddress);
    const actionTypes = [...new Set(transactions.map((tx) => tx.summary).filter(Boolean))].slice(0, 3);
    const recentActivity = transactions.length
      ? `${transactions.length} recent tx${transactions.length === 1 ? '' : 's'}${actionTypes.length ? `: ${actionTypes.join(', ')}` : ''}`
      : 'No recent activity';
    const riskSignal = this.buildRiskSignal(normalizedBalances);
    const confidence = normalizedBalances.length >= 3 && transactions.length >= 8 ? 'Medium' : 'Low';

    return {
      source: 'goldrush',
      chain: this.chainName,
      walletAddress,
      totalValue,
      balances: normalizedBalances,
      transactions,
      interactions,
      summary: {
        topHolding: topHolding?.symbol || '--',
        trackedAssets: normalizedBalances.length,
        recentActivity,
        interactionCount: transactions.length,
        topInteractions: interactions,
        riskSignal,
        visibilityConfidence: confidence,
        nextStep: confidence === 'Low'
          ? 'Additional wallet history recommended'
          : 'Ask LYRA for evidence-backed analysis'
      }
    };
  }
}

export default WalletHistory;
