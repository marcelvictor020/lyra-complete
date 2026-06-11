/**
 * Test Price Fetcher Module
 * Run: npm run test-prices
 */

import PriceFetcher from './src/prices.js';

async function testPriceFetcher() {
  console.log('🧪 Testing Price Fetcher Module\n');

  const fetcher = new PriceFetcher();

  // Test 1: Get single price by symbol
  console.log('1️⃣  Single Token Price:');
  const ethPrice = await fetcher.getPriceBySymbol('ETH');
  console.log('ETH Price: $' + (ethPrice || 'Error').toFixed(2));
  
  const usdtPrice = await fetcher.getPriceBySymbol('USDT');
  console.log('USDT Price: $' + (usdtPrice || 'Error').toFixed(2));

  const mantlePrice = await fetcher.getPriceBySymbol('MANTLE');
  console.log('MANTLE Price: $' + (mantlePrice || 'Error').toFixed(2));
  console.log();

  // Test 2: Get multiple prices at once
  console.log('2️⃣  Multiple Token Prices:');
  const prices = await fetcher.getPricesBySymbol(['ETH', 'USDT', 'MANTLE']);
  console.log('Prices:', prices);
  console.log();

  // Test 3: Calculate portfolio value
  console.log('3️⃣  Portfolio Value Calculation:');
  const mockBalances = {
    ETH: { formatted: '1.5' },
    USDT: { formatted: '2000' },
    MANTLE: { formatted: '1000' }
  };
  const portfolioValue = await fetcher.calculatePortfolioValue(mockBalances);
  console.log('Portfolio Breakdown:');
  if (portfolioValue && portfolioValue.breakdown) {
    for (const [token, data] of Object.entries(portfolioValue.breakdown)) {
      console.log(`  ${token}: ${data.balance} × $${data.price.toFixed(2)} = $${data.value.toFixed(2)}`);
    }
    console.log(`  Total Value: $${portfolioValue.total.toFixed(2)}`);
  }
  console.log();

  // Test 4: Get market data
  console.log('4️⃣  Market Data (Ethereum):');
  const marketData = await fetcher.getMarketData('ethereum');
  if (marketData) {
    console.log(`Symbol: ${marketData.symbol.toUpperCase()}`);
    console.log(`Current Price: $${marketData.current_price?.toFixed(2)}`);
    console.log(`Market Cap: $${(marketData.market_cap / 1e9).toFixed(2)}B`);
    console.log(`24h Change: ${marketData.price_change_percentage_24h?.toFixed(2)}%`);
  }
  console.log();

  // Test 5: Price history
  console.log('5️⃣  Price History (last 7 days):');
  const history = await fetcher.getPriceHistory('ethereum', '7');
  if (history && history.prices) {
    console.log(`Data points: ${history.prices.length}`);
    console.log('Latest:', `$${history.prices[history.prices.length - 1][1].toFixed(2)}`);
    const prices_arr = history.prices.map(p => p[1]);
    const lowest = Math.min(...prices_arr);
    const highest = Math.max(...prices_arr);
    console.log(`7-day range: $${lowest.toFixed(2)} - $${highest.toFixed(2)}`);
  }

  console.log('\n✅ Price fetcher tests complete!');
}

testPriceFetcher().catch(console.error);
