import axios from 'axios';

const COINGECKO_API = 'https://api.coingecko.com/api/v3';

// CoinGecko token ID mapping
const COINGECKO_IDS = {
  ETH: 'ethereum',
  USDT: 'tether',
  USDC: 'usd-coin',
  MANTLE: 'mantle',
  WETH: 'ethereum', // Same as ETH
  MNT: 'mantle'     // Mantle token
};

export class PriceFetcher {
  constructor() {
    this.cache = {};
    this.cacheExpiry = 60000; // 1 minute cache
  }

  /**
   * Get price of a single token
   * @param {string} tokenId - CoinGecko token ID (e.g., 'ethereum', 'tether')
   * @returns {Promise<number>}
   */
  async getPrice(tokenId, vs_currency = 'usd') {
    try {
      const cacheKey = `${tokenId}_${vs_currency}`;
      
      // Check cache
      if (this.cache[cacheKey] && Date.now() - this.cache[cacheKey].timestamp < this.cacheExpiry) {
        return this.cache[cacheKey].price;
      }

      const response = await axios.get(`${COINGECKO_API}/simple/price`, {
        params: {
          ids: tokenId,
          vs_currencies: vs_currency,
          include_market_cap: false,
          include_24hr_vol: false
        },
        timeout: 5000
      });

      const price = response.data[tokenId]?.[vs_currency];
      
      if (price === undefined) {
        throw new Error(`Price not found for ${tokenId}`);
      }

      // Cache the result
      this.cache[cacheKey] = {
        price: price,
        timestamp: Date.now()
      };

      return price;
    } catch (error) {
      try {
        const url = new URL(`${COINGECKO_API}/simple/price`);
        url.searchParams.set('ids', tokenId);
        url.searchParams.set('vs_currencies', vs_currency);
        const response = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'LYRA/0.1'
          }
        });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const data = await response.json();
        const price = data[tokenId]?.[vs_currency];
        if (price === undefined) throw new Error(`Price not found for ${tokenId}`);
        this.cache[`${tokenId}_${vs_currency}`] = {
          price,
          timestamp: Date.now()
        };
        return price;
      } catch (fallbackError) {
        console.error(`Error fetching price for ${tokenId}:`, fallbackError.message);
        return null;
      }
    }
  }

  /**
   * Get prices for multiple tokens
   * @param {array} tokenIds - Array of CoinGecko token IDs
   * @returns {Promise<object>}
   */
  async getPrices(tokenIds, vs_currency = 'usd') {
    try {
      const response = await axios.get(`${COINGECKO_API}/simple/price`, {
        params: {
          ids: tokenIds.join(','),
          vs_currencies: vs_currency
        },
        timeout: 5000
      });

      return response.data;
    } catch (error) {
      console.error('Error fetching prices:', error.message);
      return null;
    }
  }

  /**
   * Get price by symbol (ETH, USDT, etc.)
   * @param {string} symbol - Token symbol
   * @returns {Promise<number>}
   */
  async getPriceBySymbol(symbol, vs_currency = 'usd') {
    const tokenId = COINGECKO_IDS[symbol];
    if (!tokenId) {
      throw new Error(`Symbol ${symbol} not found in mapping`);
    }
    return this.getPrice(tokenId, vs_currency);
  }

  /**
   * Get prices for multiple symbols
   * @param {array} symbols - Token symbols (e.g., ['ETH', 'USDT', 'MANTLE'])
   * @returns {Promise<object>}
   */
  async getPricesBySymbol(symbols, vs_currency = 'usd') {
    const tokenIds = symbols.map(sym => COINGECKO_IDS[sym]).filter(Boolean);
    if (tokenIds.length === 0) {
      throw new Error('No valid symbols provided');
    }
    return this.getPrices(tokenIds, vs_currency);
  }

  /**
   * Calculate portfolio value in USD
   * @param {object} balances - Balance object from wallet.getAllBalances()
   * @returns {Promise<{total: number, breakdown: object}>}
   */
  async calculatePortfolioValue(balances) {
    try {
      const breakdown = {};
      let total = 0;

      for (const [symbol, balance] of Object.entries(balances)) {
        const price = await this.getPriceBySymbol(symbol);
        if (price) {
          const value = parseFloat(balance.formatted) * price;
          breakdown[symbol] = {
            balance: balance.formatted,
            price: price,
            value: value
          };
          total += value;
        }
      }

      return {
        total: total,
        breakdown: breakdown,
        currency: 'USD'
      };
    } catch (error) {
      console.error('Error calculating portfolio value:', error.message);
      return null;
    }
  }

  /**
   * Get price history (market chart data)
   * @param {string} tokenId - CoinGecko token ID
   * @param {string} days - Number of days (1, 7, 30, 365, max)
   * @returns {Promise<object>}
   */
  async getPriceHistory(tokenId, days = '7', vs_currency = 'usd') {
    try {
      const response = await axios.get(`${COINGECKO_API}/coins/${tokenId}/market_chart`, {
        params: {
          vs_currency: vs_currency,
          days: days,
          interval: 'daily'
        },
        timeout: 5000
      });

      return response.data;
    } catch (error) {
      console.error(`Error fetching price history for ${tokenId}:`, error.message);
      return null;
    }
  }

  /**
   * Get token market data
   * @param {string} tokenId - CoinGecko token ID
   * @returns {Promise<object>}
   */
  async getMarketData(tokenId) {
    try {
      const response = await axios.get(`${COINGECKO_API}/coins/${tokenId}`, {
        params: {
          localization: false,
          tickers: false,
          market_data: true,
          community_data: false,
          developer_data: false
        },
        timeout: 5000
      });

      const data = response.data;
      return {
        id: data.id,
        symbol: data.symbol,
        name: data.name,
        current_price: data.market_data?.current_price?.usd,
        market_cap: data.market_data?.market_cap?.usd,
        market_cap_rank: data.market_data?.market_cap_rank,
        total_volume: data.market_data?.total_volume?.usd,
        high_24h: data.market_data?.high_24h?.usd,
        low_24h: data.market_data?.low_24h?.usd,
        price_change_24h: data.market_data?.price_change_24h,
        price_change_percentage_24h: data.market_data?.price_change_percentage_24h
      };
    } catch (error) {
      console.error(`Error fetching market data for ${tokenId}:`, error.message);
      return null;
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache = {};
  }
}

export default PriceFetcher;
