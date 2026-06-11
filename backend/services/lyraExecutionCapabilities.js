const CHAIN_DEFINITIONS = [
  {
    id: 'mantle-mainnet',
    label: 'Mantle Mainnet',
    family: 'evm',
    chainId: 5000,
    mode: 'mainnet',
    nativeSymbol: 'MNT',
    rpcUrls: ['https://rpc.mantle.xyz'],
    blockExplorerUrls: ['https://explorer.mantle.xyz'],
    supports: ['swap', 'send']
  },
  {
    id: 'sepolia',
    label: 'Sepolia',
    family: 'evm',
    chainId: 11155111,
    mode: 'testnet',
    nativeSymbol: 'ETH',
    rpcUrls: ['https://rpc.sepolia.org'],
    blockExplorerUrls: ['https://sepolia.etherscan.io'],
    supports: ['bridge', 'swap', 'send']
  },
  {
    id: 'mantle-sepolia',
    label: 'Mantle Sepolia',
    family: 'evm',
    chainId: 5003,
    mode: 'testnet',
    nativeSymbol: 'MNT',
    rpcUrls: ['https://rpc.sepolia.mantle.xyz'],
    blockExplorerUrls: ['https://sepolia.mantlescan.xyz'],
    supports: ['bridge', 'swap', 'send']
  },
  {
    id: 'bsc-testnet',
    label: 'BSC Testnet',
    family: 'evm',
    chainId: 97,
    mode: 'testnet',
    nativeSymbol: 'BNB',
    rpcUrls: ['https://data-seed-prebsc-1-s1.binance.org:8545'],
    blockExplorerUrls: ['https://testnet.bscscan.com'],
    supports: ['bridge', 'swap', 'send']
  },
  {
    id: 'hyperliquid-testnet',
    label: 'Hyperliquid Testnet',
    family: 'evm',
    chainId: 998,
    mode: 'testnet',
    nativeSymbol: 'HYPE',
    rpcUrls: ['https://rpc.hyperliquid-testnet.xyz/evm'],
    blockExplorerUrls: ['https://app.hyperliquid-testnet.xyz/explorer'],
    supports: ['bridge', 'swap', 'send']
  }
];

const ACTION_DEFINITIONS = {
  bridge: {
    actionType: 'bridge',
    mode: 'action',
    executable: true,
    executionKind: 'direct',
    title: 'Bridge with LYRA',
    note: 'Select the route and amount, then sign the bridge transaction in your wallet.',
    sourceChains: ['sepolia', 'mantle-sepolia'],
    destinationChains: [],
    tokenOptions: ['MNT', 'ETH'],
    requiresRecipient: false,
    primaryLabel: 'Bridge now'
  },
  swap: {
    actionType: 'swap',
    mode: 'action',
    executable: true,
    executionKind: 'direct',
    title: 'Swap with LYRA',
    note: 'Mantle mainnet swap is live through Merchant Moe for MNT <-> ETH only.',
    sourceChains: ['mantle-mainnet'],
    destinationChains: [],
    tokenOptions: ['MNT', 'ETH'],
    requiresRecipient: false,
    primaryLabel: 'Swap now'
  },
  send: {
    actionType: 'send',
    mode: 'action',
    executable: true,
    executionKind: 'direct',
    title: 'Send with LYRA',
    note: 'Enter the recipient and amount, then sign in your wallet.',
    sourceChains: ['sepolia', 'mantle-sepolia', 'mantle-mainnet'],
    destinationChains: [],
    tokenOptions: ['MNT', 'ETH'],
    requiresRecipient: true,
    primaryLabel: 'Send asset'
  }
};

const BRIDGE_DESTINATIONS_BY_SOURCE = {
  sepolia: ['mantle-sepolia'],
  'mantle-sepolia': ['sepolia']
};

function cloneChain(chain) {
  return { ...chain, supports: [...chain.supports] };
}

function cloneAction(action) {
  return {
    ...action,
    sourceChains: [...action.sourceChains],
    destinationChains: [...action.destinationChains],
    tokenOptions: [...action.tokenOptions]
  };
}

export function getChainDefinitions() {
  return CHAIN_DEFINITIONS.map(cloneChain);
}

export function getActionDefinitions() {
  return Object.values(ACTION_DEFINITIONS).map(cloneAction);
}

export function getActionDefinition(actionType) {
  const key = String(actionType || '').toLowerCase();
  const action = ACTION_DEFINITIONS[key];
  return action ? cloneAction(action) : null;
}

export function getChainById(id) {
  const key = String(id || '').toLowerCase();
  const chain = CHAIN_DEFINITIONS.find((entry) => entry.id === key);
  return chain ? cloneChain(chain) : null;
}

export function getChainByLabel(label) {
  const key = String(label || '').trim().toLowerCase();
  const chain = CHAIN_DEFINITIONS.find((entry) => entry.label.toLowerCase() === key);
  return chain ? cloneChain(chain) : null;
}

export function resolveChains(ids = []) {
  return ids.map((id) => getChainById(id)).filter(Boolean);
}

export function getExecutionSupport(actionType) {
  const action = getActionDefinition(actionType);
  if (!action) return null;

  return {
    ...action,
    sourceChainOptions: resolveChains(action.sourceChains),
    destinationChainOptions: resolveChains(action.destinationChains)
  };
}

export function getBridgeDestinationOptions(fromNetwork) {
  const fromChain = getChainByLabel(fromNetwork) || getChainById(fromNetwork) || getChainById('sepolia');
  const destinations = BRIDGE_DESTINATIONS_BY_SOURCE[fromChain?.id] || [];
  return resolveChains(destinations);
}

export function getExecutionPanelModel(actionType, values = {}) {
  const support = getExecutionSupport(actionType);
  if (!support) return null;

  const defaultFrom = values.fromNetwork || support.sourceChainOptions[0]?.label || '';
  const destinationOptions = support.actionType === 'bridge'
    ? getBridgeDestinationOptions(defaultFrom)
    : support.destinationChainOptions;
  const requestedTo = values.toNetwork || destinationOptions[0]?.label || '';
  const defaultTo = destinationOptions.some((chain) => chain.label === requestedTo)
    ? requestedTo
    : (destinationOptions[0]?.label || '');
  const tokenSymbol = values.tokenSymbol || support.tokenOptions[0] || '';

  return {
    actionType: support.actionType,
    title: support.title,
    note: values.note || support.note,
    executionKind: support.executionKind,
    executable: support.executable,
    primaryLabel: support.primaryLabel,
    requiresRecipient: support.requiresRecipient,
    showSourceChain: true,
    sourceChainLabel: support.actionType === 'bridge' ? 'From' : 'Network',
    showDestinationChain: support.actionType === 'bridge',
    showToToken: support.actionType === 'swap',
    sourceChainOptions: support.sourceChainOptions,
    destinationChainOptions: destinationOptions,
    tokenOptions: support.tokenOptions,
    defaults: {
      amount: values.amount || '',
      tokenSymbol,
      toTokenSymbol: values.toTokenSymbol || (support.tokenOptions.find((option) => option !== tokenSymbol) || tokenSymbol),
      fromNetwork: defaultFrom,
      toNetwork: defaultTo,
      recipient: values.recipient || ''
    }
  };
}

export function validateExecutionRequest(actionType, payload = {}) {
  const support = getExecutionSupport(actionType);
  if (!support) {
    return { ok: false, error: 'Unsupported action type.' };
  }
  if (!support.executable) {
    return { ok: false, error: `${support.actionType.charAt(0).toUpperCase() + support.actionType.slice(1)} is not live on testnet in this build yet.` };
  }

  const fromChain = getChainByLabel(payload.fromNetwork);
  const toChain = payload.toNetwork ? getChainByLabel(payload.toNetwork) : null;
  const token = String(payload.tokenSymbol || '').toUpperCase();

  if (!fromChain || !support.sourceChains.includes(fromChain.id)) {
    return { ok: false, error: `Unsupported source network for ${support.actionType}.` };
  }

  const destinationIds = support.actionType === 'bridge'
    ? (BRIDGE_DESTINATIONS_BY_SOURCE[fromChain.id] || [])
    : support.destinationChains;
  if (destinationIds.length) {
    if (!toChain || !destinationIds.includes(toChain.id)) {
      return { ok: false, error: `Unsupported destination network for ${support.actionType}.` };
    }
  }

  if (token && !support.tokenOptions.includes(token)) {
    return { ok: false, error: `Unsupported asset for ${support.actionType}.` };
  }

  const toToken = String(payload.toTokenSymbol || '').toUpperCase();
  if (support.actionType === 'swap') {
    if (!toToken || !support.tokenOptions.includes(toToken)) {
      return { ok: false, error: 'Unsupported destination asset for swap.' };
    }
    if (toToken === token) {
      return { ok: false, error: 'Choose two different swap assets.' };
    }
  }

  if (support.requiresRecipient && !String(payload.recipient || '').trim()) {
    return { ok: false, error: 'Recipient is required.' };
  }

  return {
    ok: true,
    support,
    fromChain,
    toChain,
    tokenSymbol: token || support.tokenOptions[0],
    toTokenSymbol: toToken || null
  };
}

export default {
  getChainDefinitions,
  getActionDefinitions,
  getActionDefinition,
  getChainById,
  getChainByLabel,
  getBridgeDestinationOptions,
  getExecutionSupport,
  getExecutionPanelModel,
  validateExecutionRequest
};
