/**
 * Test AI Brain Module
 * Run: npm run test-ai
 */

import AIBrain from './src/ai.js';
import PortfolioContext from './src/portfolio.js';

async function testAIBrain() {
  console.log('🧪 Testing AI Brain Module\n');

  // Create mock portfolio context
  const mockPortfolioContext = {
    getSystemContext: (snapshot) => {
      return `You are LYRA, an AI copilot for DeFi on Mantle.
      
Current portfolio: ${JSON.stringify(snapshot, null, 2)}

Help the user make smart DeFi decisions.`;
    }
  };

  // Create mock snapshot
  const mockSnapshot = {
    userAddress: '0x1234...',
    network: 'mainnet',
    balances: {
      ETH: { formatted: '2.5' },
      USDT: { formatted: '5000' }
    },
    portfolioValue: {
      total: 15000,
      breakdown: {
        ETH: { price: 2000, value: 5000 },
        USDT: { price: 1, value: 5000 }
      }
    },
    positions: {},
    opportunities: {}
  };

  // Initialize AI brain
  const aiBrain = new AIBrain(mockPortfolioContext);

  console.log('1️⃣  Single message test:');
  try {
    const response = await aiBrain.chat('What can I do with my portfolio?', mockSnapshot);
    console.log('Response:', response);
    console.log();
  } catch (error) {
    console.error('Error:', error.message);
  }

  console.log('2️⃣  Multi-turn conversation:');
  try {
    const response2 = await aiBrain.chat('How can I earn more yield?', mockSnapshot);
    console.log('Response:', response2);
    console.log();
  } catch (error) {
    console.error('Error:', error.message);
  }

  console.log('3️⃣  Parse action test:');
  const testResponses = [
    'I recommend depositing 1000 USDT to Lendle for 8% APY',
    'You should swap 50% of your ETH to USDT on Agni',
    'Consider adding liquidity to the ETH-USDT pair on Agni'
  ];

  for (const resp of testResponses) {
    const action = aiBrain.parseAction(resp);
    console.log(`"${resp}"`);
    console.log(`  → Action: ${action.actionType}, Protocol: ${action.protocol}`);
  }
  console.log();

  console.log('4️⃣  Conversation history:');
  const history = aiBrain.getHistory();
  console.log(`Messages in history: ${history.length}`);
  for (const msg of history) {
    console.log(`  - ${msg.role}: ${msg.content.substring(0, 60)}...`);
  }

  console.log('\n✅ AI Brain tests complete!');
}

testAIBrain().catch(console.error);
