const LIFI_BASE_URL = process.env.LIFI_BASE_URL || 'https://li.quest/v1';

export class LifiService {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || LIFI_BASE_URL;
    this.apiKey = options.apiKey || process.env.LIFI_API_KEY || process.env.LIFI_KEY || '';
  }

  buildHeaders() {
    const headers = {
      'accept': 'application/json'
    };
    if (this.apiKey) headers['x-lifi-api-key'] = this.apiKey;
    return headers;
  }

  async fetchJson(path, params = {}) {
    const url = new URL(`${String(this.baseUrl).replace(/\/$/, '')}/${String(path).replace(/^\//, '')}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });

    const response = await fetch(url, {
      headers: this.buildHeaders()
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`LI.FI request failed (${response.status}): ${text || response.statusText}`);
    }

    return response.json();
  }

  async getChains() {
    return this.fetchJson('/chains');
  }

  async getRoutes(params) {
    return this.fetchJson('/routes', params);
  }

  async getQuote(params) {
    return this.fetchJson('/quote', params);
  }

  async getToken(chain, token) {
    return this.fetchJson('/token', { chain, token });
  }

  async getTokens(chains) {
    return this.fetchJson('/tokens', {
      chains: Array.isArray(chains) ? chains.join(',') : chains
    });
  }
}

export default LifiService;
