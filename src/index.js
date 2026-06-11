/**
 * LYRA Main Demo
 * Real wallet connection + AI chat with live data
 */

import Wallet from './src/wallet.js';
import PriceFetcher from './src/prices.js';
import PortfolioContext from './src/portfolio.js';
import AIBrain from './src/ai.js';
import Lendle from './src/protocols/lendle.js';
import dotenv from 'dotenv';

dotenv.config();

class LYRADemo {
  constructor() {
    this.wallet = null;
    this.priceFetcher = new PriceFetcher();
    this.portfolioContext = null;
    this.aiBrain = null;
    this.lendle = null;
    this.currentPortfolioSnapshot = null;
  }

  /**
   * Initialize LYRA
   */
  async initialize(network = 'mainnet', walletAddress = null) {
    console.log('🚀 Initializing LYRA...\n');

    // Setup wallet
    this.wallet = new Wallet(network);
    const networkInfo = await this.wallet.getNetworkInfo();
    console.log('📍 Network:', networkInfo.name);
    console.log('   Chain ID:', networkInfo.chainId);
    console.log('   Block:', networkInfo.blockNumber);
    console.log();

    // Setup protocols
    const provider = this.wallet.getProvider();
    this.lendle = new Lendle(provider);

    // Setup portfolio context
    this.portfolioContext = new PortfolioContext(this.wallet, this.priceFetcher);

    // Setup AI brain
    this.aiBrain = new AIBrain(this.portfolioContext);

    console.log('✅ LYRA initialized\n');
  }

  /**
   * Get current portfolio snapshot
   */
  async getPortfolioSnapshot(walletAddress) {
    try {
      console.log('📊 Fetching portfolio data...');
      
      this.currentPortfolioSnapshot = await this.portfolioContext.buildSnapshot(
        walletAddress,
        { lendle: this.lendle }
      );

      if (!this.currentPortfolioSnapshot) {
        throw new Error('Failed to build portfolio snapshot');
      }

      // Display portfolio summary
      console.log('\n' + this.portfolioContext.formatForClaude(this.currentPortfolioSnapshot));

      return this.currentPortfolioSnapshot;
    } catch (error) {
      console.error('Error fetching portfolio:', error.message);
      return null;
    }
  }

  /**
   * Chat with LYRA
   */
  async chat(userMessage) {
    if (!this.currentPortfolioSnapshot) {
      console.log('❌ No portfolio data. Call getPortfolioSnapshot first.');
      return null;
    }

    console.log('\n👤 You: ' + userMessage);
    console.log('🤖 LYRA: ', { end: '' }); // No newline yet

    try {
      const response = await this.aiBrain.chat(userMessage, this.currentPortfolioSnapshot);
      console.log(response);

      // Parse action if present
      const action = this.aiBrain.parseAction(response);
      if (action.actionType) {
        console.log('\n⚡ Detected action:', {
          type: action.actionType,
          protocol: action.protocol,
          requiresApproval: action.requiresApproval
        });
      }

      return response;
    } catch (error) {
      console.error('\n❌ Error:', error.message);
      return null;
    }
  }

  /**
   * Demo conversation flow
   */
  async demo() {
    // For demo, we'll use a test wallet address
    // Replace with a real address that has tokens on Mantle
    const testWallet = process.env.TEST_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000';

    if (!Wallet.isValidAddress(testWallet)) {
      console.log('⚠️  Please set TEST_WALLET_ADDRESS in .env with a real Mantle wallet address');
      console.log('   Or update the testWallet variable in this script\n');
      
      // Still show the architecture without real data
      console.log('📋 LYRA Architecture Ready - Waiting for wallet...\n');
      return;
    }

    // Initialize
    await this.initialize('mainnet', testWallet);

    // Get portfolio
    await this.getPortfolioSnapshot(testWallet);

    // Start conversations
    const questions = [
      'What is my current portfolio worth?',
      'What are the best yields I can get right now?',
      'Should I move any of my USDT to earn yield?'
    ];

    for (const q of questions) {
      await this.chat(q);
      console.log('---');
      
      // Small delay between requests
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log('\n✅ Demo complete!');
  }
}

// Run demo
async function main() {
  const demo = new LYRADemo();
  await demo.demo();
}

main().catch(console.error);
