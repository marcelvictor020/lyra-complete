/**
 * Portfolio Context Builder
 * Assembles real portfolio data for Claude to use as context
 */

export class PortfolioContext {
  constructor(wallet, priceFetcher) {
    this.wallet = wallet;
    this.priceFetcher = priceFetcher;
  }

  /**
   * Build complete portfolio snapshot
   * @param {string} userAddress - User's wallet address
   * @param {object} protocols - Protocol instances (lendle, agni, etc.)
   * @returns {Promise<object>}
   */
  async buildSnapshot(userAddress, protocols = {}) {
    try {
      // Get all balances
      const balances = await this.wallet.getAllBalances(userAddress);

      // Get portfolio value
      const portfolioValue = await this.priceFetcher.calculatePortfolioValue(balances);

      // Get protocol positions (if available)
      const positions = {};
      if (protocols.lendle) {
        positions.lendle = await protocols.lendle.getUserPositions(userAddress, {});
      }

      // Get available opportunities
      const opportunities = {};
      if (protocols.lendle) {
        const yields = await protocols.lendle.getAvailableYields();
        opportunities.lendle = yields.slice(0, 5); // Top 5 yields
      }

      return {
        timestamp: new Date().toISOString(),
        userAddress: userAddress,
        network: this.wallet.network,
        balances: balances,
        portfolioValue: portfolioValue,
        positions: positions,
        opportunities: opportunities
      };
    } catch (error) {
      console.error('Error building portfolio snapshot:', error.message);
      return null;
    }
  }

  /**
   * Format portfolio for Claude context (more concise)
   * @param {object} snapshot - Portfolio snapshot from buildSnapshot
   * @returns {string}
   */
  formatForClaude(snapshot) {
    if (!snapshot) return 'No portfolio data available.';

    let context = `**Portfolio Summary**\n`;
    context += `Total Value: $${snapshot.portfolioValue?.total?.toFixed(2) || '0.00'}\n\n`;

    context += `**Holdings:**\n`;
    for (const [symbol, balance] of Object.entries(snapshot.balances)) {
      const value = snapshot.portfolioValue?.breakdown?.[symbol]?.value || 0;
      const price = snapshot.portfolioValue?.breakdown?.[symbol]?.price || 0;
      context += `- ${symbol}: ${balance.formatted} ($${value.toFixed(2)}) @ $${price.toFixed(2)}\n`;
    }

    if (snapshot.positions && Object.keys(snapshot.positions).length > 0) {
      context += `\n**Active Positions:**\n`;
      for (const [protocol, pos] of Object.entries(snapshot.positions)) {
        if (pos && pos.length > 0) {
          context += `${protocol.toUpperCase()}:\n`;
          for (const p of pos) {
            context += `  - ${p.symbol}: ${p.deposited} @ ${p.apy}% APY\n`;
          }
        }
      }
    }

    if (snapshot.opportunities && Object.keys(snapshot.opportunities).length > 0) {
      context += `\n**Best Available Yields:**\n`;
      for (const [protocol, opps] of Object.entries(snapshot.opportunities)) {
        if (opps && opps.length > 0) {
          context += `${protocol.toUpperCase()}: `;
          context += opps.map(o => `${o.apy}% APY`).join(', ') + '\n';
        }
      }
    }

    return context;
  }

  /**
   * Get portfolio context for system prompt
   * @param {object} snapshot - Portfolio snapshot
   * @returns {string}
   */
  getSystemContext(snapshot) {
    return `You are LYRA, an AI DeFi intelligence agent focused on Mantle.

Your job is to sound like a portfolio analyst and DeFi strategist, not a database dump.

Current Portfolio Context:
${this.formatForClaude(snapshot)}

Rules:
1. Ground every conclusion in visible wallet evidence or live Mantle protocol data.
2. If evidence is incomplete, say so clearly and reduce confidence.
3. Never output raw JSON or unstructured API dumps.
4. Prefer this answer structure when relevant:
Insight
Reasoning
Evidence
Confidence
Sources
5. Explain why an opportunity matters specifically on Mantle.
6. Explain tradeoffs, risks, and uncertainty.
7. Do not pretend the wallet supports a conclusion if the evidence is thin.
8. Do not claim execution happened. Only discuss opportunities and reasoning.

Users stay in control.`;
  }
}

export default PortfolioContext;
