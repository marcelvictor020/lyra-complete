const NANSEN_BASE_URL = process.env.NANSEN_BASE_URL || 'https://api.nansen.ai/api/v1';

export class NansenService {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || NANSEN_BASE_URL;
    this.apiKey = options.apiKey || process.env.NANSEN_API_KEY || '';
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  buildHeaders() {
    return {
      accept: 'application/json',
      'Content-Type': 'application/json',
      apiKey: this.apiKey
    };
  }

  async fetchJson(path, params = {}, options = {}) {
    const url = new URL(`${String(this.baseUrl).replace(/\/$/, '')}/${String(path).replace(/^\//, '')}`);
    const method = options.method || 'GET';
    if (method === 'GET') {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      });
    }

    const response = await fetch(url, {
      method,
      headers: this.buildHeaders(),
      body: method === 'GET' ? undefined : JSON.stringify(params)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Nansen request failed (${response.status}): ${text || response.statusText}`);
    }

    return response.json();
  }

  async getAddressTransactions(address, options = {}) {
    if (!this.isConfigured()) return [];
    const now = new Date();
    const from = new Date(now);
    from.setFullYear(from.getFullYear() - Number(options.years || 8));
    const data = await this.fetchJson('/profiler/address/transactions', {
      address,
      chain: options.chain || options.chains || 'all',
      date: {
        from: from.toISOString(),
        to: now.toISOString()
      },
      hide_spam_token: true,
      pagination: {
        page: 1,
        per_page: Math.min(Number(options.limit || 100), 100)
      },
      order_by: [
        {
          field: 'block_timestamp',
          direction: options.order || 'ASC'
        }
      ]
    }, { method: 'POST' });
    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return items;
  }

  async getCurrentBalance(address, options = {}) {
    if (!this.isConfigured()) return null;
    return this.fetchJson(`/profiler/address/${address}/current-balance`, {
      chains: options.chains || 'all'
    });
  }

  async getHistoricalBalances(address, options = {}) {
    if (!this.isConfigured()) return [];
    const data = await this.fetchJson(`/profiler/address/${address}/historical-balances`, {
      chains: options.chains || 'all',
      limit: options.limit || 30
    });
    return Array.isArray(data?.items) ? data.items : Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  }
}

export default NansenService;
