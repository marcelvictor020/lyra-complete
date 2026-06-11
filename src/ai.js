import Anthropic from '@anthropic-ai/sdk';

export class AIBrain {
  constructor(portfolioContext) {
    this.portfolioContext = portfolioContext;
    this.conversationHistory = [];
    this.client = null;
    this.provider = process.env.OPENROUTER_API_KEY ? 'openrouter' : 'anthropic';
  }

  getClient() {
    if (this.provider === 'openrouter') {
      return null;
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('No supported AI provider key is configured');
    }
    if (!this.client) {
      this.client = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY
      });
    }
    return this.client;
  }

  async createOpenRouterMessage(systemPrompt) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://127.0.0.1:3000',
        'X-Title': 'LYRA'
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet',
        temperature: 0.2,
        max_tokens: 1024,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          ...this.conversationHistory
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const assistantMessage = data?.choices?.[0]?.message?.content;
    if (!assistantMessage || typeof assistantMessage !== 'string') {
      throw new Error('Unexpected response format from OpenRouter');
    }
    return assistantMessage;
  }

  /**
   * Send message to Claude with portfolio context
   * @param {string} userMessage - User's input
   * @param {object} portfolioSnapshot - Current portfolio data
   * @returns {Promise<string>}
   */
  async chat(userMessage, portfolioSnapshot) {
    try {
      const systemPrompt = this.portfolioContext.getSystemContext(portfolioSnapshot);
      this.conversationHistory.push({
        role: 'user',
        content: userMessage
      });

      const assistantMessage = this.provider === 'openrouter'
        ? await this.createOpenRouterMessage(systemPrompt)
        : await this.createAnthropicMessage(systemPrompt);

      this.conversationHistory.push({
        role: 'assistant',
        content: assistantMessage
      });

      return assistantMessage;
    } catch (error) {
      console.error('Error calling AI API:', error.message);
      return `Error: Unable to process your request. ${error.message}`;
    }
  }

  async createAnthropicMessage(systemPrompt) {
    const response = await this.getClient().messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: this.conversationHistory
    });

    const textContent = response.content[0];
    if (!textContent || textContent.type !== 'text') {
      throw new Error('Unexpected response format from Anthropic');
    }

    return textContent.text;
  }

  /**
   * Parse Claude's response for action intent
   * @param {string} response - Claude's response text
   * @returns {object}
   */
  parseAction(response) {
    const lowerResponse = response.toLowerCase();

    // Detect action type
    let actionType = null;
    if (lowerResponse.includes('deposit') || lowerResponse.includes('supply')) {
      actionType = 'deposit';
    } else if (lowerResponse.includes('withdraw') || lowerResponse.includes('exit')) {
      actionType = 'withdraw';
    } else if (lowerResponse.includes('swap') || lowerResponse.includes('exchange')) {
      actionType = 'swap';
    } else if (lowerResponse.includes('provide liquidity') || lowerResponse.includes('lp')) {
      actionType = 'addLiquidity';
    }

    // Extract protocol
    let protocol = null;
    if (lowerResponse.includes('lendle')) protocol = 'lendle';
    else if (lowerResponse.includes('agni')) protocol = 'agni';
    else if (lowerResponse.includes('merchant moe')) protocol = 'merchantMoe';

    return {
      actionType: actionType,
      protocol: protocol,
      requiresApproval: actionType !== null,
      rawResponse: response
    };
  }

  /**
   * Clear conversation history
   */
  clearHistory() {
    this.conversationHistory = [];
  }

  /**
   * Get conversation history
   * @returns {array}
   */
  getHistory() {
    return [...this.conversationHistory];
  }

  /**
   * Get last message from assistant
   * @returns {string}
   */
  getLastMessage() {
    const lastMsg = this.conversationHistory.filter(m => m.role === 'assistant').pop();
    return lastMsg ? lastMsg.content : null;
  }
}

export default AIBrain;
