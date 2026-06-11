/**
 * LYRA Protocol Configuration
 * All contract addresses and ABIs for Mantle integration
 */

// ============================================
// MANTLE NETWORK CONFIGURATION
// ============================================

export const NETWORKS = {
  MAINNET: {
    chainId: 5000,
    name: 'Mantle',
    rpc: 'https://rpc.mantle.xyz',
    explorer: 'https://explorer.mantle.xyz'
  },
  TESTNET: {
    chainId: 5003,
    name: 'Mantle Sepolia',
    rpc: 'https://rpc.sepolia.mantle.xyz',
    explorer: 'https://sepolia.explorer.mantle.xyz'
  }
};

// ============================================
// TOKEN ADDRESSES (MAINNET)
// ============================================

export const TOKENS_MAINNET = {
  MANTLE: {
    address: '0x78c1b0c915c4faa5fffa6cabf0219da63d7f4cb8',
    decimals: 18,
    symbol: 'MNT'
  },
  WETH: {
    address: '0xdeaddeadad35ff0341f4347b5d590ff43570600c',
    decimals: 18,
    symbol: 'WETH'
  },
  USDT: {
    address: '0x201eba5cc46d216ce6dc03f6e7e62c1e5cdf5c89',
    decimals: 6,
    symbol: 'USDT'
  },
  USDC: {
    address: '0x09Bc4E0D864854c1b0F3126CaF7a4a5FdB7eC5E6',
    decimals: 6,
    symbol: 'USDC'
  },
  mETH: {
    address: '0xcDA86A272531e8640cD7F1a910741c9e60893532',
    decimals: 18,
    symbol: 'mETH'
  }
};

// ============================================
// LENDLE PROTOCOL (LENDING)
// ============================================

export const LENDLE = {
  lendingPool: {
    address: '0x1e1e391e1d7db1a7fd89c5f7f28c70fc7d0d8e8e',
    name: 'Lendle Lending Pool',
    description: 'Main lending pool for deposits and withdrawals'
  },
  dataProvider: {
    address: '0x34e2ed44EF7466D5f9E0b0129473FEbDA6B40A0e',
    name: 'Lendle Data Provider'
  },
  aTokens: {
    aUSDT: {
      address: '0x8A4a3DB1e56F9B85D8e8aFBF5b9B8E3B7D8e8e8e',
      underlying: TOKENS_MAINNET.USDT.address,
      decimals: 6
    },
    aWETH: {
      address: '0x7d00A6C2B2ec8e6b7C4b6eeFcD8d9a8eFCAB9f48',
      underlying: TOKENS_MAINNET.WETH.address,
      decimals: 18
    }
  },
  expectedAPYs: {
    USDT: '8-10%',
    WETH: '3-5%',
    USDC: '8-10%'
  }
};

// ============================================
// AGNI FINANCE (DEX & LIQUIDITY)
// ============================================

export const AGNI = {
  router: {
    address: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff',
    name: 'Agni Router',
    description: 'Swap and liquidity routing'
  },
  factory: {
    address: '0xBB86CbA837869c2f9EF0b84C1A59b5218aA9Ce5B',
    name: 'Agni Factory',
    description: 'Create and manage pools'
  },
  positions: {
    address: '0xC36442b4a4522E871399CD717aBDD847Ab11fe88',
    name: 'Agni Position Manager',
    description: 'Manage LP positions'
  },
  topPools: {
    WETH_USDT: {
      address: '0x...',
      token0: TOKENS_MAINNET.WETH.address,
      token1: TOKENS_MAINNET.USDT.address,
      fee: 3000
    }
  }
};

// ============================================
// MERCHANT MOE (LIQUIDITY & STAKING)
// ============================================

export const MERCHANT_MOE = {
  moeToken: {
    address: '0x371c7ec6D8039ff7933A2AA28EB827Ffe1F52f07',
    symbol: 'MOE',
    decimals: 18
  },
  distributor: {
    address: '0x...',
    description: 'Reward distributor'
  },
  stakingPools: {
    MOE: {
      address: '0x...',
      reward: 'MOE',
      expectedAPY: '50-100%'
    }
  }
};

// ============================================
// ERC-20 ABI (Standard)
// ============================================

export const ERC20_ABI = [
  'function name() external view returns (string)',
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)',
  'function totalSupply() external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function transfer(address recipient, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function transferFrom(address sender, address recipient, uint256 amount) external returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)'
];

// ============================================
// LENDLE POOL ABI
// ============================================

export const LENDLE_POOL_ABI = [
  'function deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external',
  'function withdraw(address asset, uint256 amount, address to) external returns (uint256)',
  'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external',
  'function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) external returns (uint256)',
  'function getReservesList() external view returns (address[])',
  'function getReserveData(address asset) external view returns (tuple(uint128 currentLiquidityRate, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint8 id))',
  'function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'function setUserUseReserveAsCollateral(address asset, bool useAsCollateral) external'
];

// ============================================
// AGNI ROUTER ABI
// ============================================

export const AGNI_ROUTER_ABI = [
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)',
  'function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)',
  'function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)',
  'function getAmountsIn(uint256 amountOut, address[] calldata path) external view returns (uint256[] memory amounts)',
  'function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB, uint256 liquidity)',
  'function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB)',
  'function factory() external view returns (address)',
  'function WETH() external view returns (address)'
];

// ============================================
// COMMON TRANSACTION SETTINGS
// ============================================

export const TX_DEFAULTS = {
  gasBuffer: 1.2,  // 20% buffer for gas estimation
  slippageTolerance: 0.01,  // 1% max slippage
  deadlineMinutes: 20,  // 20 minute transaction deadline
  referralCode: 0  // No referral for now
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

export function getTokenAddress(symbol, network = 'mainnet') {
  if (network === 'mainnet') {
    return TOKENS_MAINNET[symbol]?.address;
  }
  return null;
}

export function getTokenDecimals(symbol, network = 'mainnet') {
  if (network === 'mainnet') {
    return TOKENS_MAINNET[symbol]?.decimals || 18;
  }
  return 18;
}

export function getContractsByProtocol(protocol) {
  switch (protocol.toLowerCase()) {
    case 'lendle':
      return LENDLE;
    case 'agni':
      return AGNI;
    case 'merchant-moe':
    case 'merchantmoe':
      return MERCHANT_MOE;
    default:
      return null;
  }
}

export default {
  NETWORKS,
  TOKENS_MAINNET,
  LENDLE,
  AGNI,
  MERCHANT_MOE,
  ERC20_ABI,
  LENDLE_POOL_ABI,
  AGNI_ROUTER_ABI,
  TX_DEFAULTS,
  getTokenAddress,
  getTokenDecimals,
  getContractsByProtocol
};
