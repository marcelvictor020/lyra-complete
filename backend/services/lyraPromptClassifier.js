const GREETING_PATTERN = /^(hi|hello|hey|yo|good morning|good afternoon|good evening)\b/i;

export function classifyLyraPrompt(message = '') {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();

  if (!text) return { mode: 'research', intent: 'empty' };
  if (GREETING_PATTERN.test(lower)) return { mode: 'research', intent: 'greeting' };
  if (/\bbridge\b/.test(lower)) return { mode: 'action', intent: 'bridge' };
  if (/\bswap\b/.test(lower)) return { mode: 'action', intent: 'swap' };
  if (/\bsend\b/.test(lower)) return { mode: 'action', intent: 'send' };
  if (lower.includes('compare')) return { mode: 'research', intent: 'compare' };
  if (lower.includes('yield') || lower.includes('apy') || lower.includes('opportunit')) {
    return { mode: 'research', intent: 'opportunity' };
  }
  if (lower.includes('wallet') || lower.includes('portfolio') || lower.includes('activity')) {
    return { mode: 'research', intent: 'wallet-analysis' };
  }
  return { mode: 'research', intent: 'general' };
}

export function isWalletDependentIntent(classification) {
  const intent = classification?.intent || '';
  return ['wallet-analysis', 'bridge', 'swap', 'send'].includes(intent);
}

export default {
  classifyLyraPrompt,
  isWalletDependentIntent
};
