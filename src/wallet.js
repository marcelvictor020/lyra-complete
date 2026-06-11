import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

const MANTLE_RPC_MAINNET = process.env.MANTLE_RPC_MAINNET || 'https://rpc.mantle.xyz';
const MANTLE_RPC_TESTNET = process.env.MANTLE_RPC_TESTNET || 'https://rpc.sepolia.mantle.xyz';

// ERC-20 ABI (minimal for balanceOf + decimals)
const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)'
];

// Token addresses on Mantle Mainnet
const TOKENS_MAINNET = {
  USDT: '0x201eba5cc46d216ce6dc03f6e7e62c1e5cdf5c89',
  WETH: '0xdeaddeadad35ff0341f4347b5d590ff43570600c',
  MANTLE: '0x78c1b0c915c4faa5fffa6cabf0219da63d7f4cb8'
};

// Token addresses on Mantle Testnet (Sepolia)
const TOKENS_TESTNET = {
  USDT: '0x68Ef6f5aCf86f3F3E7a37dF2a0b0e0bEf8e8e8e8', // Example testnet address
  WETH: '0x4200000000000000000000000000000000000001'
};

export class Wallet {
  constructor(network = 'mainnet') {
    this.network = network;
    this.rpcUrl = network === 'mainnet' ? MANTLE_RPC_MAINNET : MANTLE_RPC_TESTNET;
    this.provider = new ethers.JsonRpcProvider(this.rpcUrl);
    this.tokens = network === 'mainnet' ? TOKENS_MAINNET : TOKENS_TESTNET;
  }

  /**
   * Get provider instance
   */
  getProvider() {
    return this.provider;
  }

  /**
   * Get token address by symbol
   */
  getTokenAddress(symbol) {
    return this.tokens[symbol] || null;
  }

  /**
   * Read balance of a token for a user
   * @param {string} userAddress - User's wallet address
   * @param {string} tokenSymbol - Token symbol (e.g., 'USDT', 'WETH')
   * @returns {Promise<{raw: string, formatted: string, decimals: number}>}
   */
  async getTokenBalance(userAddress, tokenSymbol) {
    try {
      const tokenAddress = this.getTokenAddress(tokenSymbol);
      if (!tokenAddress) {
        throw new Error(`Token ${tokenSymbol} not found`);
      }

      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      
      const [balance, decimals, symbol, name] = await Promise.all([
        contract.balanceOf(userAddress),
        contract.decimals(),
        contract.symbol(),
        contract.name()
      ]);

      const formatted = ethers.formatUnits(balance, decimals);

      return {
        symbol: symbol,
        name: name,
        raw: balance.toString(),
        formatted: formatted,
        decimals: decimals,
        address: tokenAddress
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Get all token balances for a user
   * @param {string} userAddress - User's wallet address
   * @param {array} tokens - Token symbols to fetch (default: all)
   * @returns {Promise<object>}
   */
  async getBalances(userAddress, tokens = Object.keys(this.tokens)) {
    const balances = {};
    
    for (const token of tokens) {
      const balance = await this.getTokenBalance(userAddress, token);
      if (balance) {
        balances[token] = balance;
      }
    }

    return balances;
  }

  /**
   * Get native gas token balance for the configured network
   * @param {string} userAddress - User's wallet address
   * @returns {Promise<{raw: string, formatted: string}>}
   */
  async getETHBalance(userAddress) {
    try {
      const balance = await this.provider.getBalance(userAddress);
      const formatted = ethers.formatEther(balance);
      const isMantleNetwork = this.network === 'mainnet' || this.network === 'testnet';
      const nativeSymbol = isMantleNetwork ? 'MNT' : 'ETH';
      const nativeName = isMantleNetwork
        ? (this.network === 'testnet' ? 'Mantle Testnet' : 'Mantle')
        : 'Ethereum';

      return {
        symbol: nativeSymbol,
        name: nativeName,
        raw: balance.toString(),
        formatted: formatted,
        decimals: 18
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Get all balances (ETH + tokens)
   * @param {string} userAddress - User's wallet address
   * @returns {Promise<object>}
   */
  async getAllBalances(userAddress) {
    const balances = {};

    // Get native gas token balance
    const nativeBalance = await this.getETHBalance(userAddress);
    if (nativeBalance) {
      balances[nativeBalance.symbol] = nativeBalance;
    }

    // Get token balances
    const tokenBalances = await this.getBalances(userAddress);
    Object.assign(balances, tokenBalances);

    return balances;
  }

  /**
   * Validate if address is valid Ethereum address
   * @param {string} address - Address to validate
   * @returns {boolean}
   */
  static isValidAddress(address) {
    return ethers.isAddress(address);
  }

  /**
   * Format address to checksum
   * @param {string} address - Address to format
   * @returns {string}
   */
  static getChecksumAddress(address) {
    return ethers.getAddress(address);
  }

  /**
   * Get network info
   * @returns {Promise<object>}
   */
  async getNetworkInfo() {
    try {
      const network = await this.provider.getNetwork();
      const blockNumber = await this.provider.getBlockNumber();
      const gasPrice = await this.provider.getGasPrice();

      return {
        name: network.name,
        chainId: network.chainId,
        blockNumber: blockNumber,
        gasPrice: ethers.formatUnits(gasPrice, 'gwei') + ' gwei'
      };
    } catch (error) {
      return null;
    }
  }
}

export default Wallet;
