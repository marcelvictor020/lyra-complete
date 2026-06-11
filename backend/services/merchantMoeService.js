import { ethers } from 'ethers';

const MANTLE_MAINNET_RPC_URL = process.env.MANTLE_MAINNET_RPC_URL || 'https://mantle-rpc.publicnode.com';
const MANTLE_MAINNET_NETWORK = { chainId: 5000, name: 'mantle' };

export const MERCHANT_MOE_CONTRACTS = {
  ROUTER: '0xeaEE7EE68874218c3558b40063c42B82D3E7232a',
  FACTORY: '0x5bEf015CA9424A7C07B68490616a4C1F094BEdEc',
  QUOTER: '0x501b8AFd35df20f531fF45F6f695793AC3316c85',
  WNATIVE: '0x78c1b0c915c4faa5fffa6cabf0219da63d7f4cb8',
  WETH: '0xdeaddeaddeaddeaddeaddeaddeaddeaddead1111'
};

const ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
  'function swapExactNativeForTokens(uint256 amountOutMin,address[] path,address to,uint256 deadline) payable returns (uint256[] amounts)',
  'function swapExactTokensForNative(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline) returns (uint256[] amounts)',
  'function wNative() view returns (address)'
];

const routerInterface = new ethers.Interface(ROUTER_ABI);

function normalizeTokenSymbol(symbol = '') {
  const upper = String(symbol || '').trim().toUpperCase();
  if (upper === 'WETH') return 'ETH';
  if (upper === 'WMNT') return 'MNT';
  return upper;
}

function amountToUnits(amount, decimals = 18) {
  const [wholePart, fractionalPart = ''] = String(amount || '0').trim().split('.');
  const whole = wholePart && /^\d+$/.test(wholePart) ? wholePart : '0';
  const normalizedFraction = `${fractionalPart.replace(/\D/g, '')}${'0'.repeat(decimals)}`.slice(0, decimals);
  return (BigInt(whole) * (10n ** BigInt(decimals))) + BigInt(normalizedFraction || '0');
}

function toHexQuantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function buildTokenMeta(symbol) {
  const normalized = normalizeTokenSymbol(symbol);
  if (normalized === 'MNT') {
    return {
      symbol: 'MNT',
      address: MERCHANT_MOE_CONTRACTS.WNATIVE,
      isNative: true,
      decimals: 18
    };
  }

  if (normalized === 'ETH') {
    return {
      symbol: 'ETH',
      address: MERCHANT_MOE_CONTRACTS.WETH,
      isNative: false,
      decimals: 18
    };
  }

  throw new Error(`${normalized} is not supported for Merchant Moe swap execution.`);
}

class MerchantMoeService {
  constructor(options = {}) {
    this.provider = options.provider || new ethers.JsonRpcProvider(MANTLE_MAINNET_RPC_URL, MANTLE_MAINNET_NETWORK);
    this.routerAddress = options.routerAddress || MERCHANT_MOE_CONTRACTS.ROUTER;
    this.router = new ethers.Contract(this.routerAddress, ROUTER_ABI, this.provider);
    this.slippageBps = Number(options.slippageBps || 100);
  }

  async buildSwapIntent(options = {}) {
    const amount = String(options.amount || '').trim();
    if (!amount) {
      throw new Error('Amount is required.');
    }

    const fromToken = buildTokenMeta(options.fromTokenSymbol || 'MNT');
    const toToken = buildTokenMeta(options.toTokenSymbol || 'ETH');
    if (fromToken.symbol === toToken.symbol) {
      throw new Error('Choose two different swap assets.');
    }

    const recipient = options.recipient || options.fromAddress;
    if (!recipient) {
      throw new Error('Recipient wallet is required.');
    }

    const amountIn = amountToUnits(amount, fromToken.decimals);
    if (amountIn <= 0n) {
      throw new Error('Amount must be greater than zero.');
    }

    const path = [fromToken.address, toToken.address];
    const quotedAmounts = await this.router.getAmountsOut(amountIn, path);
    const quotedOut = BigInt(quotedAmounts?.[quotedAmounts.length - 1] || 0n);
    if (quotedOut <= 0n) {
      throw new Error('Merchant Moe could not quote that swap right now.');
    }

    const minOut = quotedOut * BigInt(10_000 - this.slippageBps) / 10_000n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);
    const transactionRequest = fromToken.isNative
      ? {
          to: this.routerAddress,
          data: routerInterface.encodeFunctionData('swapExactNativeForTokens', [minOut, path, recipient, deadline]),
          value: toHexQuantity(amountIn)
        }
      : {
          to: this.routerAddress,
          data: routerInterface.encodeFunctionData('swapExactTokensForNative', [amountIn, minOut, path, recipient, deadline]),
          value: '0x0'
        };

    return {
      type: 'swap',
      status: 'ready',
      executionKind: 'direct',
      summary: `Merchant Moe swap prepared for ${amount} ${fromToken.symbol}.`,
      fromToken: fromToken.symbol,
      toToken: toToken.symbol,
      fromAmount: amount,
      estimate: {
        provider: 'Merchant Moe',
        amountIn: amountIn.toString(),
        amountOut: quotedOut.toString(),
        minAmountOut: minOut.toString(),
        slippageBps: this.slippageBps
      },
      tool: 'Merchant Moe',
      routeId: `merchant-moe:${fromToken.symbol.toLowerCase()}-${toToken.symbol.toLowerCase()}`,
      fromTokenAddress: fromToken.isNative ? ethers.ZeroAddress : fromToken.address,
      fromTokenDecimals: fromToken.decimals,
      toTokenAddress: toToken.isNative ? ethers.ZeroAddress : toToken.address,
      toTokenDecimals: toToken.decimals,
      approvalAddress: fromToken.isNative ? null : this.routerAddress,
      transactionRequest,
      nextStep: fromToken.isNative
        ? 'Sign the swap transaction in your wallet.'
        : 'Sign the token approval if prompted, then sign the swap transaction.'
    };
  }
}

export default MerchantMoeService;
