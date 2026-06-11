/**
 * Test Wallet Module
 * Run: npm run test-wallet
 */

import Wallet from './src/wallet.js';

async function testWallet() {
  console.log('🧪 Testing Wallet Module\n');

  // Initialize wallet on mainnet
  const wallet = new Wallet('mainnet');

  // Test 1: Get network info
  console.log('1️⃣  Network Info:');
  const networkInfo = await wallet.getNetworkInfo();
  console.log(networkInfo);
  console.log();

  // Test 2: Get token addresses
  console.log('2️⃣  Token Addresses:');
  console.log('USDT:', wallet.getTokenAddress('USDT'));
  console.log('WETH:', wallet.getTokenAddress('WETH'));
  console.log('MANTLE:', wallet.getTokenAddress('MANTLE'));
  console.log();

  // Test 3: Validate address
  const testAddress = '0x1234567890123456789012345678901234567890';
  console.log('3️⃣  Address Validation:');
  console.log('Is valid:', Wallet.isValidAddress(testAddress));
  console.log();

  // Test 4: Get balance for a real wallet (example Mantle holder)
  // You can replace this with a known wallet address
  const exampleAddress = '0x0000000000000000000000000000000000000001'; // Replace with real address
  
  if (Wallet.isValidAddress(exampleAddress)) {
    console.log('4️⃣  Balances for:', exampleAddress);
    
    // Get ETH balance
    const ethBalance = await wallet.getETHBalance(exampleAddress);
    console.log('ETH:', ethBalance);

    // Get token balances
    const allBalances = await wallet.getBalances(exampleAddress, ['USDT', 'WETH']);
    console.log('Token Balances:', allBalances);
  } else {
    console.log('⚠️  Please set TEST_WALLET_ADDRESS in .env or replace exampleAddress with a real address');
  }

  console.log('\n✅ Wallet tests complete!');
}

testWallet().catch(console.error);
