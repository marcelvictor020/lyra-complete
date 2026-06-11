import { ethers } from 'ethers';

// Lendle contract addresses on Mantle Mainnet
const LENDLE_CONTRACTS = {
  lendingPool: '0x1e1e391e1d7db1a7fd89c5f7f28c70fc7d0d8e8e',
  dataProvider: '0x34e2ed44EF7466D5f9E0b0129473FEbDA6B40A0e',
  // Add aToken addresses as needed
  aUSDT: '0x8A4a3DB1e56F9B85D8e8aFBF5b9B8E3B7D8e8e8e', // Example
  aWETH: '0x7d00A6C2B2ec8e6b7C4b6eeFcD8d9a8eFCAB9f48'
};

// Lendle LendingPool ABI (minimal for our use case)
const LENDLE_POOL_ABI = [
  'function getReservesList() external view returns (address[])',
  'function getReserveData(address asset) external view returns (tuple(uint128 currentLiquidityRate, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint8 id))',
  'function deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external',
  'function withdraw(address asset, uint256 amount, address to) external returns (uint256)',
  'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external',
  'function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) external returns (uint256)',
  'function liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken) external'
];

// aToken ABI (for reading balances)
const ATOKEN_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function scaledBalanceOf(address user) external view returns (uint256)',
  'function getScaledUserBalanceAndSupply(address user) external view returns (uint256, uint256)'
];

export class Lendle {
  constructor(provider) {
    this.provider = provider;
    this.lendingPool = new ethers.Contract(
      LENDLE_CONTRACTS.lendingPool,
      LENDLE_POOL_ABI,
      provider
    );
  }

  /**
   * Get all reserves (supported assets)
   * @returns {Promise<array>}
   */
  async getReserves() {
    try {
      const reserves = await this.lendingPool.getReservesList();
      return reserves;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get reserve data (interest rates, liquidity)
   * @param {string} assetAddress - Token contract address
   * @returns {Promise<object>}
   */
  async getReserveData(assetAddress) {
    try {
      const data = await this.lendingPool.getReserveData(assetAddress);
      
      // Convert ray to APY (ray has 27 decimals)
      const currentLiquidityRate = parseFloat(data.currentLiquidityRate) / (10 ** 27);
      const currentVariableBorrowRate = parseFloat(data.currentVariableBorrowRate) / (10 ** 27);

      return {
        currentLiquidityRate: currentLiquidityRate,
        currentLiquidityRatePercent: (currentLiquidityRate * 100).toFixed(2),
        currentVariableBorrowRate: currentVariableBorrowRate,
        currentVariableBorrowRatePercent: (currentVariableBorrowRate * 100).toFixed(2),
        currentStableBorrowRate: parseFloat(data.currentStableBorrowRate) / (10 ** 27),
        lastUpdateTimestamp: parseInt(data.lastUpdateTimestamp),
        aTokenAddress: data.aTokenAddress,
        isActive: true
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Get user's aToken balance (deposited amount)
   * @param {string} userAddress - User's wallet address
   * @param {string} aTokenAddress - aToken contract address
   * @returns {Promise<object>}
   */
  async getUserBalance(userAddress, aTokenAddress) {
    try {
      const aToken = new ethers.Contract(aTokenAddress, ATOKEN_ABI, this.provider);
      
      const [balance, decimals, symbol] = await Promise.all([
        aToken.balanceOf(userAddress),
        aToken.decimals(),
        aToken.symbol()
      ]);

      const formatted = ethers.formatUnits(balance, decimals);

      return {
        symbol: symbol,
        raw: balance.toString(),
        formatted: formatted,
        decimals: decimals,
        aTokenAddress: aTokenAddress
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Get all user positions in Lendle
   * @param {string} userAddress - User's wallet address
   * @param {object} tokenMap - Map of token addresses to symbols (for lookup)
   * @returns {Promise<array>}
   */
  async getUserPositions(userAddress, tokenMap) {
    try {
      const reserves = await this.getReserves();
      const positions = [];

      for (const assetAddress of reserves) {
        const reserveData = await this.getReserveData(assetAddress);
        
        if (reserveData) {
          const balance = await this.getUserBalance(userAddress, reserveData.aTokenAddress);
          
          // Only include positions with non-zero balance
          if (balance && parseFloat(balance.formatted) > 0) {
            positions.push({
              asset: assetAddress,
              symbol: tokenMap[assetAddress] || 'UNKNOWN',
              deposited: balance.formatted,
              apy: reserveData.currentLiquidityRatePercent,
              aToken: balance.symbol,
              aTokenBalance: balance.formatted
            });
          }
        }
      }

      return positions;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get available yields across all reserves
   * @returns {Promise<array>}
   */
  async getAvailableYields() {
    try {
      const reserves = await this.getReserves();
      const yields = [];

      for (const assetAddress of reserves) {
        const reserveData = await this.getReserveData(assetAddress);
        
        if (reserveData && reserveData.currentLiquidityRatePercent > 0) {
          yields.push({
            asset: assetAddress,
            apy: reserveData.currentLiquidityRatePercent,
            aTokenAddress: reserveData.aTokenAddress
          });
        }
      }

      // Sort by APY descending
      return yields.sort((a, b) => parseFloat(b.apy) - parseFloat(a.apy));
    } catch (error) {
      return [];
    }
  }

  /**
   * Build deposit transaction (unsigned)
   * @param {string} assetAddress - Token to deposit
   * @param {string} amount - Amount in wei
   * @param {string} userAddress - User's address
   * @returns {Promise<object>}
   */
  async buildDepositTx(assetAddress, amount, userAddress) {
    try {
      // Build the function call data
      const txData = this.lendingPool.interface.encodeFunctionData('deposit', [
        assetAddress,
        amount,
        userAddress,
        0 // referral code
      ]);

      return {
        to: LENDLE_CONTRACTS.lendingPool,
        data: txData,
        value: '0'
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Build withdraw transaction (unsigned)
   * @param {string} assetAddress - Token to withdraw
   * @param {string} amount - Amount in wei
   * @param {string} userAddress - User's address
   * @returns {Promise<object>}
   */
  async buildWithdrawTx(assetAddress, amount, userAddress) {
    try {
      const txData = this.lendingPool.interface.encodeFunctionData('withdraw', [
        assetAddress,
        amount,
        userAddress
      ]);

      return {
        to: LENDLE_CONTRACTS.lendingPool,
        data: txData,
        value: '0'
      };
    } catch (error) {
      return null;
    }
  }
}

export default Lendle;
