function roundUsd(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Number(numeric.toFixed(2));
}

function formatLowConfidenceMessage(dominantChain, activeChains) {
  if (activeChains.length <= 1 && dominantChain) {
    return `Current scan primarily includes ${dominantChain} activity. Additional wallet history required.`;
  }
  return 'Additional wallet history required.';
}

function buildConfidencePercent({ activeChains, transactionCount, holdings, visibleTotalUsd, hasNativeBalance }) {
  let score = 18;
  score += Math.min(activeChains.length, 4) * 12;
  score += Math.min(transactionCount, 60) * 0.65;
  score += Math.min(holdings.length, 5) * 6;
  if (visibleTotalUsd > 0) score += 8;
  if (hasNativeBalance) score += 4;
  return Math.max(18, Math.min(92, Math.round(score)));
}

function buildConfidenceReason({ activeChains, transactionCount, holdings, visibleTotalUsd, dominantChain }) {
  const reasons = [];
  reasons.push(`${transactionCount} transactions analyzed`);
  reasons.push(`${activeChains.length} chain${activeChains.length === 1 ? '' : 's'} detected`);
  if (holdings.length) {
    reasons.push(`${holdings.length} funded holding${holdings.length === 1 ? '' : 's'} observed`);
  } else if (visibleTotalUsd > 0) {
    reasons.push('Funded portfolio value detected');
  } else {
    reasons.push('Limited funded activity visible');
  }
  if (dominantChain) {
    reasons.push(`${dominantChain} currently dominates observed activity`);
  }
  return reasons.join(' • ');
}

export function analyzeWalletIntelligence({
  alchemyBalances,
  recentTransactions,
  portfolio,
  chainActivity,
  tokenDistribution
}) {
  const activeChainSet = new Set();
  const nativeBalance = alchemyBalances?.nativeBalance || null;
  const nativeAmount = Number(nativeBalance?.formatted || 0);
  const hasNativeBalance = nativeBalance && nativeAmount > 0;

  if (hasNativeBalance && alchemyBalances?.network === 'mantle-mainnet') {
    activeChainSet.add('Mantle');
  }

  for (const entry of portfolio || []) {
    if (entry.totalValue > 0 || entry.balances?.length) activeChainSet.add(entry.chainLabel);
  }
  for (const entry of chainActivity || []) {
    if (entry.transactionCount > 0) activeChainSet.add(entry.chainLabel);
  }

  const activeChains = Array.from(activeChainSet);
  const chainTransactionCount = (chainActivity || []).reduce((total, entry) => total + Number(entry.transactionCount || 0), 0);
  const alchemyTransactionCount = (recentTransactions || []).reduce((total, tx) => total + Number(tx.count || 1), 0);
  const transactionCount = Math.max(chainTransactionCount, alchemyTransactionCount);

  const chainScores = new Map();
  if (hasNativeBalance && alchemyBalances?.network === 'mantle-mainnet') {
    chainScores.set('Mantle', { value: 0, txs: alchemyTransactionCount || 1 });
  }

  for (const entry of portfolio || []) {
    const previous = chainScores.get(entry.chainLabel) || { value: 0, txs: 0 };
    previous.value += Number(entry.totalValue || 0);
    chainScores.set(entry.chainLabel, previous);
  }
  for (const entry of chainActivity || []) {
    const previous = chainScores.get(entry.chainLabel) || { value: 0, txs: 0 };
    previous.txs += Number(entry.transactionCount || 0);
    chainScores.set(entry.chainLabel, previous);
  }

  const dominantChain = Array.from(chainScores.entries())
    .sort((a, b) => {
      const aScore = (a[1].value * 1000) + a[1].txs;
      const bScore = (b[1].value * 1000) + b[1].txs;
      return bScore - aScore;
    })[0]?.[0] || null;

  const holdings = (tokenDistribution?.holdings || []).slice(0, 5).map((holding) => ({
    symbol: holding.symbol,
    name: holding.name,
    valueUsd: roundUsd(holding.valueUsd),
    chains: holding.chains
  }));

  if (hasNativeBalance && !holdings.some((holding) => holding.symbol === nativeBalance.symbol)) {
    holdings.push({
      symbol: nativeBalance.symbol,
      name: nativeBalance.name,
      amount: nativeBalance.formatted,
      valueUsd: 0,
      chains: alchemyBalances?.network === 'mantle-mainnet' ? ['Mantle'] : [alchemyBalances?.network || 'Alchemy']
    });
  }

  const visibleTotalUsd = Number(tokenDistribution?.totalValueUsd || 0);
  const stablecoinValueUsd = Number(tokenDistribution?.stablecoinValueUsd || 0);
  const stablecoinExposure = {
    valueUsd: roundUsd(stablecoinValueUsd),
    percentOfVisiblePortfolio: visibleTotalUsd > 0 ? Number(((stablecoinValueUsd / visibleTotalUsd) * 100).toFixed(1)) : 0,
    visibleSymbols: (tokenDistribution?.stablecoins || []).map((asset) => asset.symbol)
  };

  const evidenceSignals = {
    activeChains: activeChains.length,
    transactionCount,
    fundedHoldings: holdings.length,
    visiblePortfolioValueUsd: roundUsd(visibleTotalUsd),
    mantleVisible: activeChains.includes('Mantle'),
    nativeBalanceVisible: hasNativeBalance
  };

  let confidenceLevel = 'LOW';
  if (activeChains.length >= 3 && transactionCount >= 25 && holdings.length >= 3) {
    confidenceLevel = 'HIGH';
  } else if (activeChains.length >= 2 && transactionCount >= 8 && holdings.length >= 2) {
    confidenceLevel = 'MEDIUM';
  }

  const confidencePercent = buildConfidencePercent({
    activeChains,
    transactionCount,
    holdings,
    visibleTotalUsd,
    hasNativeBalance
  });
  const confidenceReason = buildConfidenceReason({
    activeChains,
    transactionCount,
    holdings,
    visibleTotalUsd,
    dominantChain
  });

  const walletConfidence = {
    level: confidenceLevel,
    percent: confidencePercent,
    message: confidenceLevel === 'LOW'
      ? formatLowConfidenceMessage(dominantChain, activeChains)
      : confidenceLevel === 'MEDIUM'
        ? 'Visible wallet activity supports directional analysis, but cross-chain coverage may still be incomplete.'
        : 'Visible wallet activity is broad enough for higher-confidence directional analysis.',
    reason: confidenceReason,
    evidenceSignals
  };

  return {
    dominantChain,
    topHoldings: holdings,
    transactionCount,
    activeChains,
    stablecoinExposure,
    walletConfidence,
    alchemy: {
      network: alchemyBalances?.network || 'mantle-mainnet',
      nativeBalance: alchemyBalances?.nativeBalance || null,
      tokenCount: alchemyBalances?.tokenHoldings?.length || 0,
      recentTransferCount: recentTransactions?.length || 0
    }
  };
}

export default analyzeWalletIntelligence;
