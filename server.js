import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { ethers } from 'ethers';

import Wallet from './src/wallet.js';
import PriceFetcher from './src/prices.js';
import PortfolioContext from './src/portfolio.js';
import AIBrain from './src/ai.js';
import Lendle from './src/protocols/lendle.js';
import WalletHistory from './src/history.js';
import AlchemyService from './backend/services/alchemyService.js';
import CovalentService from './backend/services/covalentService.js';
import NansenService from './backend/services/nansenService.js';
import analyzeWalletIntelligence from './backend/services/walletAnalyzer.js';
import ProtocolRegistryService from './backend/services/protocolRegistryService.js';
import LifiService from './backend/services/lifiService.js';
import MerchantMoeService from './backend/services/merchantMoeService.js';
import {
  getExecutionPanelModel,
  getExecutionSupport,
  validateExecutionRequest
} from './backend/services/lyraExecutionCapabilities.js';
import { classifyLyraPrompt, isWalletDependentIntent } from './backend/services/lyraPromptClassifier.js';
import { saveWalletScan, getLatestWalletScan, saveAgentDecision, getRecentAgentDecisions } from './backend/db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

const wallet = new Wallet(process.env.NETWORK || 'mainnet');
const priceFetcher = new PriceFetcher();
const portfolioContext = new PortfolioContext(wallet, priceFetcher);
const lendle = new Lendle(wallet.getProvider());
const aiBrain = (process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY) ? new AIBrain(portfolioContext) : null;
const walletHistory = new WalletHistory();
const protocolRegistry = new ProtocolRegistryService();
const lifiService = new LifiService();
const merchantMoeService = new MerchantMoeService();
const alchemyService = new AlchemyService({
  apiKey: process.env.ALCHEMY_API_KEY || null
});
const covalentService = new CovalentService({
  apiKey: process.env.GOLDRUSH_API_KEY || process.env.COVALENT_API_KEY || null
});
const nansenService = new NansenService({
  apiKey: process.env.NANSEN_API_KEY || null
});
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
let marketTapeCache = {
  timestamp: 0,
  data: null
};
let mantlePoolsCache = {
  timestamp: 0,
  data: []
};
const ALCHEMY_VISIBILITY_NETWORKS = [
  { network: 'eth-mainnet', label: 'Ethereum' },
  { network: 'base-mainnet', label: 'Base' },
  { network: 'arbitrum-mainnet', label: 'Arbitrum' },
  { network: 'optimism-mainnet', label: 'Optimism' },
  { network: 'mantle-mainnet', label: 'Mantle' }
];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function safeJsonStringify(data) {
  const seen = new WeakSet();
  return JSON.stringify(data, (key, value) => {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    if (value instanceof Error) {
      return {
        message: value.message,
        stack: value.stack
      };
    }
    if (value && typeof value === 'object') {
      if (seen.has(value)) {
        return undefined;
      }
      seen.add(value);
    }
    return value;
  });
}

function sendJson(res, status, data) {
  const body = safeJsonStringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function withTimeout(promise, timeoutMs, label = 'Request') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs))
  ]);
}

async function fetchJson(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'LYRA/0.1'
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function getCachedMantlePools() {
  const now = Date.now();
  if (Array.isArray(mantlePoolsCache.data) && mantlePoolsCache.data.length && now - mantlePoolsCache.timestamp < 60_000) {
    return mantlePoolsCache.data;
  }

  const poolsResponse = await fetchJson('https://yields.llama.fi/pools').catch(() => ({ data: [] }));
  const mantlePools = (poolsResponse?.data || [])
    .filter((pool) => String(pool.chain || '').toLowerCase() === 'mantle')
    .filter((pool) => Number(pool.tvlUsd || 0) > 1000)
    .filter((pool) => !/frozen/i.test(String(pool.poolMeta || '')))
    .filter((pool) => Number(pool.apy || 0) > 0)
    .sort((a, b) => Number(b.apy || 0) - Number(a.apy || 0));

  mantlePoolsCache = {
    timestamp: now,
    data: mantlePools
  };

  return mantlePools;
}

function formatUsd(value, compact = false) {
  if (value === undefined || value === null || value === '') return '--';
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  if (compact && Math.abs(number) >= 1_000_000_000) return `$${(number / 1_000_000_000).toFixed(2)}B`;
  if (compact && Math.abs(number) >= 1_000_000) return `$${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1000) return `$${number.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (number >= 1) return `$${number.toFixed(2)}`;
  return `$${number.toFixed(4)}`;
}

function formatPct(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '';
  const sign = number > 0 ? '+' : '';
  return `${sign}${number.toFixed(1)}%`;
}

function pickProtocol(protocols = [], names = []) {
  const normalized = names.map((name) => name.toLowerCase());
  const matches = protocols.filter((protocol) => {
    const name = String(protocol.name || '').toLowerCase();
    return normalized.some((target) => name === target || name.includes(target));
  });

  return matches
    .filter((protocol) => {
      const chains = Array.isArray(protocol.chains) ? protocol.chains : [protocol.chain];
      return chains.some((chain) => String(chain || '').toLowerCase() === 'mantle');
    })
    .sort((a, b) => Number(b.tvl || 0) - Number(a.tvl || 0))[0] || matches[0];
}

function protocolMantleTvl(protocol) {
  if (!protocol) return null;
  const chainTvls = protocol.chainTvls || protocol.chainTVLs || null;
  if (chainTvls && typeof chainTvls === 'object') {
    const direct = chainTvls.Mantle ?? chainTvls.mantle ?? null;
    if (Number.isFinite(Number(direct))) return Number(direct);
    const found = Object.entries(chainTvls).find(([key]) => String(key || '').toLowerCase() === 'mantle');
    if (found && Number.isFinite(Number(found[1]))) return Number(found[1]);
  }
  return Number.isFinite(Number(protocol.tvl)) ? Number(protocol.tvl) : null;
}

function pickStablePool(pools = []) {
  const stableSymbols = ['USDC', 'USDT', 'USDe', 'mUSD'];
  return pools
    .filter((pool) => String(pool.chain || '').toLowerCase() === 'mantle')
    .filter((pool) => stableSymbols.some((symbol) => String(pool.symbol || '').toUpperCase().includes(symbol.toUpperCase())))
    .filter((pool) => Number(pool.apy || 0) > 0)
    .sort((a, b) => Number(b.tvlUsd || 0) - Number(a.tvlUsd || 0))[0];
}

function pickMntUsdcPool(pools = []) {
  return pools
    .filter((pool) => String(pool.chain || '').toLowerCase() === 'mantle')
    .filter((pool) => {
      const symbol = String(pool.symbol || '').toUpperCase();
      return symbol.includes('MNT') && symbol.includes('USDC');
    })
    .filter((pool) => Number(pool.apy || 0) > 0)
    .sort((a, b) => Number(b.tvlUsd || 0) - Number(a.tvlUsd || 0))[0];
}

function pickTopLendingPool(pools = []) {
  const lendingHints = ['aave', 'lendle', 'clearpool', 'layerbank', 'lending', 'credit'];
  return pools
    .filter((pool) => String(pool.chain || '').toLowerCase() === 'mantle')
    .filter((pool) => Number(pool.apy || 0) > 0)
    .filter((pool) => {
      const project = String(pool.project || '').toLowerCase();
      const meta = String(pool.poolMeta || '').toLowerCase();
      return lendingHints.some((hint) => project.includes(hint) || meta.includes(hint));
    })
    .sort((a, b) => Number(b.apy || 0) - Number(a.apy || 0))[0];
}

function pickTopLpPool(pools = []) {
  const lpHints = ['merchant moe', 'agni', 'fusionx', 'pairs', 'lp'];
  return pools
    .filter((pool) => String(pool.chain || '').toLowerCase() === 'mantle')
    .filter((pool) => Number(pool.apy || 0) > 0)
    .filter((pool) => {
      const project = String(pool.project || '').toLowerCase();
      const meta = String(pool.poolMeta || '').toLowerCase();
      const symbol = String(pool.symbol || '').toLowerCase();
      return lpHints.some((hint) => project.includes(hint) || meta.includes(hint))
        || symbol.includes('-')
        || symbol.includes('/');
    })
    .sort((a, b) => Number(b.apy || 0) - Number(a.apy || 0))[0];
}

function parseAddressFromPath(url, prefix) {
  if (!url.startsWith(prefix)) return null;
  const raw = decodeURIComponent(url.slice(prefix.length)).split('?')[0].trim();
  return raw || null;
}

function protocolSourceUrl(project = '') {
  const lower = String(project || '').toLowerCase();
  if (lower.includes('lendle')) return 'https://www.lendle.xyz/markets';
  if (lower.includes('merchant')) return 'https://merchantmoe.com/';
  if (lower.includes('agni')) return 'https://www.agni.finance/';
  return 'https://defillama.com/yields';
}

function protocolRiskLabel(pool) {
  const symbol = String(pool?.symbol || '').toUpperCase();
  const meta = String(pool?.poolMeta || '').toLowerCase();
  if (/USDC|USDT|USDE|DAI/.test(symbol)) return 'Lower';
  if (meta.includes('volatile') || /ETH|BTC|MNT/.test(symbol)) return 'Medium';
  return 'Medium';
}

function formatOpportunityLine(pool, index) {
  return [
    `${index + 1}. ${pool.project} — ${pool.symbol}`,
    `   Category: ${pool.poolMeta || 'Mantle route'}`,
    `   APY: ${Number(pool.apy).toFixed(2)}%`,
    `   TVL: ${formatUsd(pool.tvlUsd, true)}`,
    `   Risk: ${protocolRiskLabel(pool)}`,
    `   Source: ${protocolSourceUrl(pool.project)}`
  ].join('\n');
}

function formatConfidenceBlock(latestScan, fallbackConfidence) {
  if (latestScan?.walletConfidence?.percent) {
    return [
      `Confidence: ${latestScan.walletConfidence.percent}%`,
      `Reason: ${latestScan.walletConfidence.reason || latestScan.walletConfidence.message || 'Visible activity supports partial analysis.'}`
    ].join('\n');
  }
  if (latestScan?.confidence) {
    return `Confidence: ${latestScan.confidence}`;
  }
  if (fallbackConfidence) {
    return `Confidence: ${fallbackConfidence}`;
  }
  return 'Confidence: Limited';
}

function humanizeProtocolName(name) {
  return String(name || '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function confidenceLabel(latestScan, snapshot) {
  const level = latestScan?.walletConfidence?.level || snapshot?.summary?.visibilityConfidence || 'Low';
  const normalized = String(level).toUpperCase();
  if (normalized === 'HIGH') return 'High';
  if (normalized === 'MEDIUM') return 'Moderate';
  return 'Limited';
}

function confidenceMicrocopy(latestScan) {
  const txs = Number(latestScan?.transactionCount || 0);
  const chains = Number(latestScan?.activeChains?.length || 0);
  if (!txs && !chains) return 'Visible history is still narrow.';
  return `${txs} txs • ${chains} chain${chains === 1 ? '' : 's'}`;
}

function historyCoverageLabel(latestScan) {
  const chains = latestScan?.activeChains || [];
  if (!chains.length) return 'Limited';
  if (chains.length === 1) return `${chains[0]}-only`;
  return `${chains.length} chains visible`;
}

function protocolMetaForPool(pool) {
  return protocolRegistry.findByProjectName(pool?.project) || null;
}

function mantlePlacementLabel(pool) {
  const meta = protocolMetaForPool(pool);
  return meta?.mantleNative ? 'Mantle-native' : 'Available on Mantle';
}

function mantlePlacementExplanation(pool) {
  const meta = protocolMetaForPool(pool);
  return meta?.mantleNative
    ? 'This protocol is part of the Mantle-native stack, so the fit is stronger for a Mantle-first pitch.'
    : 'This route is deployed on Mantle, but it is not a Mantle-native product. LYRA should treat it as available on Mantle, not as core native infrastructure.';
}

function preferRegistryBackedPools(pools = [], limit = 3) {
  const registryBacked = pools.filter((pool) => protocolMetaForPool(pool));
  if (registryBacked.length >= limit) return registryBacked.slice(0, limit);
  const seen = new Set(registryBacked.map((pool) => `${pool.project}:${pool.symbol}`));
  const fallback = pools.filter((pool) => {
    const key = `${pool.project}:${pool.symbol}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...registryBacked, ...fallback].slice(0, limit);
}

function formatCompactRouteCard(pool, index) {
  const lines = [
    `${index + 1}. ${pool.project} — ${pool.symbol}`,
    `   Category: ${pool.poolMeta || 'Mantle route'}`,
    `   APY: ${Number(pool.apy || 0).toFixed(2)}%`,
    `   TVL: ${formatUsd(pool.tvlUsd, true)}`,
    `   Risk: ${protocolRiskLabel(pool)}`,
    `   Source: ${protocolSourceUrl(pool.project)}`
  ];
  return lines.join('\n');
}

function getProtocolDisplay(pool) {
  const meta = protocolMetaForPool(pool);
  const poolMeta = String(pool?.poolMeta || '').trim();
  const fallbackCategory = /^\d+(\.\d+)?%$/.test(poolMeta) || poolMeta.length < 4
    ? 'Mantle route'
    : poolMeta;
  return {
    name: meta?.name || humanizeProtocolName(pool?.project),
    category: meta?.category || fallbackCategory || 'Mantle route',
    risk: meta?.riskLabel || protocolRiskLabel(pool),
    appUrl: meta?.appUrl || protocolSourceUrl(pool?.project),
    docsUrl: meta?.docsUrl || meta?.sourceUrl || protocolSourceUrl(pool?.project),
    sourceUrl: meta?.sourceUrl || protocolSourceUrl(pool?.project),
    supports: meta?.supports || []
  };
}

function getConfidenceData(latestScan, snapshot) {
  const label = confidenceLabel(latestScan, snapshot);
  const microcopy = confidenceMicrocopy(latestScan);
  const reasoning = latestScan?.walletConfidence?.reason
    || latestScan?.walletConfidence?.message
    || 'Visible activity is still partial.';
  return { label, microcopy, reasoning };
}

function buildActionChip(label, url, variant = 'secondary') {
  if (!url) return '';
  if (String(url).startsWith('lyra-action:')) {
    const action = String(url).replace('lyra-action:', '');
    return `<button class="lyra-chip-link ${variant}" type="button" data-lyra-action="${escapeHtml(action)}">${escapeHtml(label)}</button>`;
  }
  return `<a class="lyra-chip-link ${variant}" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function protocolActionLabel(display) {
  if (display.supports.includes('bridge')) return `Open ${display.name}`;
  if (display.supports.includes('swap')) return `Open ${display.name}`;
  if (display.supports.includes('lp')) return `Open ${display.name}`;
  if (display.supports.includes('supply')) return `Open ${display.name}`;
  return `View ${display.name}`;
}

function renderProtocolCard(pool, index) {
  const display = getProtocolDisplay(pool);
  return `
    <article class="lyra-protocol-card">
      <div class="lyra-protocol-head">
        <div>
          <div class="lyra-protocol-rank">Route ${index + 1}</div>
          <div class="lyra-protocol-name">${escapeHtml(display.name)} — ${escapeHtml(pool?.symbol || '--')}</div>
          <div class="lyra-protocol-category">${escapeHtml(display.category)}</div>
        </div>
      </div>
      <div class="lyra-protocol-metrics">
        <div class="lyra-metric">
          <div class="lyra-metric-label">APY</div>
          <div class="lyra-metric-value">${Number(pool?.apy || 0).toFixed(2)}%</div>
        </div>
        <div class="lyra-metric">
          <div class="lyra-metric-label">TVL</div>
          <div class="lyra-metric-value">${formatUsd(pool?.tvlUsd, true)}</div>
        </div>
        <div class="lyra-metric">
          <div class="lyra-metric-label">Risk</div>
          <div class="lyra-metric-value">${escapeHtml(display.risk)}</div>
        </div>
      </div>
      <div class="lyra-link-row">
        ${buildActionChip(protocolActionLabel(display), display.appUrl, 'primary')}
        ${buildActionChip('Docs', display.docsUrl)}
        ${buildActionChip('Source', display.sourceUrl)}
      </div>
    </article>
  `;
}

function renderBulletList(items = []) {
  return items.filter(Boolean).map((line) => `<div>${escapeHtml(line)}</div>`).join('');
}

function renderComparisonResponse({
  title,
  answer,
  left,
  right,
  verdict,
  nextStep,
  actions = [],
  sources = [],
  latestScan = null,
  snapshot = null
}) {
  const confidence = getConfidenceData(latestScan, snapshot);
  const sourceLinks = Array.from(new Map(
    sources.filter(Boolean).map((source) => [source.url, source])
  ).values());

  return `
    <div class="lyra-rich-response">
      <div class="lyra-rich-block">
        <div class="lyra-rich-label">Comparison</div>
        <div class="lyra-rich-copy">${escapeHtml(title)}</div>
      </div>
      <div class="lyra-rich-hero">${escapeHtml(answer)}</div>
      <div class="lyra-compare-grid">
        <article class="lyra-compare-card">
          <div class="lyra-rich-label">Option A</div>
          <div class="lyra-compare-title">${escapeHtml(left.title)}</div>
          <div class="lyra-compare-copy">${escapeHtml(left.copy)}</div>
          <div class="lyra-compare-points">${renderBulletList(left.points || [])}</div>
          <div class="lyra-link-row">
            ${(left.links || []).map((link) => buildActionChip(link.label, link.url, link.primary ? 'primary' : 'secondary')).join('')}
          </div>
        </article>
        <article class="lyra-compare-card">
          <div class="lyra-rich-label">Option B</div>
          <div class="lyra-compare-title">${escapeHtml(right.title)}</div>
          <div class="lyra-compare-copy">${escapeHtml(right.copy)}</div>
          <div class="lyra-compare-points">${renderBulletList(right.points || [])}</div>
          <div class="lyra-link-row">
            ${(right.links || []).map((link) => buildActionChip(link.label, link.url, link.primary ? 'primary' : 'secondary')).join('')}
          </div>
        </article>
      </div>
      <div class="lyra-rich-block">
        <div class="lyra-rich-label">LYRA call</div>
        <div class="lyra-rich-copy">${escapeHtml(verdict)}</div>
      </div>
      <div class="lyra-rich-block">
        <div class="lyra-rich-label">Next move</div>
        <div class="lyra-rich-copy">${escapeHtml(nextStep)}</div>
      </div>
      <div class="lyra-action-row">
        ${actions.map((action) => buildActionChip(action.label, action.url, action.primary ? 'primary' : 'secondary')).join('')}
      </div>
      <div class="lyra-rich-block">
        <div class="lyra-rich-label">Sources</div>
        <div class="lyra-source-list">
          ${sourceLinks.map((source) => buildActionChip(source.label, source.url)).join('')}
        </div>
      </div>
      <details class="lyra-why">
        <summary>How confident is this read?</summary>
        <div class="lyra-why-copy">
          <div class="lyra-rich-block">
            <div class="lyra-rich-label">Confidence</div>
            <div class="lyra-rich-copy">${escapeHtml(confidence.label)}${confidence.microcopy ? ` • ${escapeHtml(confidence.microcopy)}` : ''}</div>
          </div>
          <div class="lyra-rich-block">
            <div class="lyra-rich-label">Scan note</div>
            <div class="lyra-rich-copy">${escapeHtml(confidence.reasoning)}</div>
          </div>
        </div>
      </details>
    </div>
  `;
}

function renderPlanResponse({
  title,
  answer,
  steps = [],
  evidence = [],
  nextStep,
  actions = [],
  sources = [],
  latestScan = null,
  snapshot = null
}) {
  const confidence = getConfidenceData(latestScan, snapshot);
  const sourceLinks = Array.from(new Map(
    sources.filter(Boolean).map((source) => [source.url, source])
  ).values());
  return `
    <div class="lyra-rich-response">
      <div class="lyra-rich-block">
        <div class="lyra-rich-label">Plan</div>
        <div class="lyra-rich-copy">${escapeHtml(title)}</div>
      </div>
      <div class="lyra-rich-hero">${escapeHtml(answer)}</div>
      <div class="lyra-plan-grid">
        ${steps.map((step, index) => `
          <article class="lyra-plan-card">
            <div class="lyra-rich-label">Step ${index + 1}</div>
            <div class="lyra-compare-title">${escapeHtml(step.title)}</div>
            <div class="lyra-compare-copy">${escapeHtml(step.copy)}</div>
            <div class="lyra-compare-points">${renderBulletList(step.points || [])}</div>
          </article>
        `).join('')}
      </div>
      ${evidence.length ? `
        <div class="lyra-rich-block">
          <div class="lyra-rich-label">What I checked</div>
          <div class="lyra-rich-copy">${renderBulletList(evidence)}</div>
        </div>
      ` : ''}
      <div class="lyra-rich-block">
        <div class="lyra-rich-label">Next move</div>
        <div class="lyra-rich-copy">${escapeHtml(nextStep)}</div>
      </div>
      <div class="lyra-action-row">
        ${actions.map((action) => buildActionChip(action.label, action.url, action.primary ? 'primary' : 'secondary')).join('')}
      </div>
      <div class="lyra-rich-block">
        <div class="lyra-rich-label">Sources</div>
        <div class="lyra-source-list">
          ${sourceLinks.map((source) => buildActionChip(source.label, source.url)).join('')}
        </div>
      </div>
      <details class="lyra-why">
        <summary>How confident is this read?</summary>
        <div class="lyra-why-copy">
          <div class="lyra-rich-block">
            <div class="lyra-rich-label">Confidence</div>
            <div class="lyra-rich-copy">${escapeHtml(confidence.label)}${confidence.microcopy ? ` • ${escapeHtml(confidence.microcopy)}` : ''}</div>
          </div>
          <div class="lyra-rich-block">
            <div class="lyra-rich-label">Scan note</div>
            <div class="lyra-rich-copy">${escapeHtml(confidence.reasoning)}</div>
          </div>
        </div>
      </details>
    </div>
  `;
}

function renderResearchResponse({
  insight,
  reasoning,
  mantleContext,
  nextStep,
  pools = [],
  latestScan = null,
  snapshot = null,
  extraEvidence = [],
  actions = [],
  sources = []
}) {
  const confidence = getConfidenceData(latestScan, snapshot);
  const bridge = protocolRegistry.getById('mantle-bridge');
  const faucet = protocolRegistry.getById('mantle-faucet');
  const actionLinks = [
    ...actions,
    bridge?.appUrl ? { label: 'Bridge to Mantle', url: bridge.appUrl, primary: false } : null,
    faucet?.appUrl ? { label: 'Get Testnet Faucet', url: faucet.appUrl, primary: false } : null
  ].filter(Boolean);
  const dedupedActions = Array.from(new Map(
    actionLinks.map((action) => [`${action.label}:${action.url}`, action])
  ).values());
  const sourceLinks = Array.from(new Map(
    sources.filter(Boolean).map((source) => [source.url, source])
  ).values());

  return `
    <div class="lyra-rich-response">
      <div class="lyra-rich-block">
        <div class="lyra-rich-label">Answer</div>
        <div class="lyra-rich-copy">${escapeHtml(insight)}</div>
      </div>
      <div class="lyra-rich-block">
        <div class="lyra-rich-label">Why this fits</div>
        <div class="lyra-rich-copy">${escapeHtml(reasoning)}</div>
      </div>
      ${sourceLinks.length ? `
        <div class="lyra-rich-block">
          <div class="lyra-rich-label">Sources</div>
          <div class="lyra-source-list">
            ${sourceLinks.map((source) => buildActionChip(source.label, source.url)).join('')}
          </div>
        </div>
      ` : ''}
      ${pools.length ? `<div class="lyra-protocol-list">${pools.map((pool, index) => renderProtocolCard(pool, index)).join('')}</div>` : ''}
      ${extraEvidence.length ? `
        <div class="lyra-rich-block">
          <div class="lyra-rich-label">What I checked</div>
          <div class="lyra-rich-copy">${extraEvidence.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}</div>
        </div>
      ` : ''}
      <div class="lyra-rich-block">
        <div class="lyra-rich-label">Mantle angle</div>
        <div class="lyra-rich-copy">${escapeHtml(mantleContext)}</div>
      </div>
      <div class="lyra-rich-block">
        <div class="lyra-rich-label">Next move</div>
        <div class="lyra-rich-copy">${escapeHtml(nextStep)}</div>
      </div>
      <div class="lyra-action-row">
        ${dedupedActions.map((action) => buildActionChip(action.label, action.url, action.primary ? 'primary' : 'secondary')).join('')}
      </div>
      <details class="lyra-why">
        <summary>How confident is this read?</summary>
        <div class="lyra-why-copy">
          <div class="lyra-rich-block">
            <div class="lyra-rich-label">Confidence</div>
            <div class="lyra-rich-copy">${escapeHtml(confidence.label)}${confidence.microcopy ? ` — ${escapeHtml(confidence.microcopy)}` : ''}</div>
          </div>
          <div class="lyra-rich-block">
            <div class="lyra-rich-label">Scan note</div>
            <div class="lyra-rich-copy">${escapeHtml(confidence.reasoning)}</div>
          </div>
          <div class="lyra-rich-block">
            <div class="lyra-rich-label">Data sources used</div>
            <div class="lyra-source-list">
              ${sourceLinks.map((source) => buildActionChip(source.label, source.url)).join('')}
            </div>
          </div>
        </div>
      </details>
    </div>
  `;
}

function renderExecutionPanel({
  actionType,
  amount = '',
  tokenSymbol = '',
  toTokenSymbol = '',
  fromNetwork = '',
  toNetwork = '',
  recipient = '',
  note = '',
  mode = 'prepare'
}) {
  const action = String(actionType || '').toLowerCase();
  const panel = getExecutionPanelModel(action, {
    amount,
    tokenSymbol,
    toTokenSymbol,
    fromNetwork,
    toNetwork,
    recipient,
    note
  });
  if (!panel) return '';

  const defaultFrom = panel.defaults.fromNetwork;
  const defaultTo = panel.defaults.toNetwork;
  const selectedToken = panel.defaults.tokenSymbol;
  const selectedToToken = panel.defaults.toTokenSymbol;

  const renderSelect = (name, selected, options) => `
    <select name="${escapeHtml(name)}" class="lyra-exec-select">
      ${options.map((option) => {
        const label = typeof option === 'string' ? option : option.label;
        const value = typeof option === 'string' ? option : option.label;
        return `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
      }).join('')}
    </select>
  `;

  return `
    <div class="lyra-rich-response lyra-execution-response" data-execution-mode="${escapeHtml(action)}">
      <div class="lyra-exec-shell">
        <div class="lyra-exec-topline">
          <div class="lyra-rich-label">Action mode</div>
          <div class="lyra-exec-title">${escapeHtml(panel.title)}</div>
        </div>
        <div class="lyra-exec-note">${escapeHtml(panel.note)}</div>
        <form class="lyra-exec-form" data-execution-form="${escapeHtml(action)}" data-execution-mode="${escapeHtml(mode)}">
          <input type="hidden" name="actionType" value="${escapeHtml(action)}">
          <input type="hidden" name="executionKind" value="${escapeHtml(panel.executionKind)}">
          <div class="lyra-exec-grid ${action === 'send' ? 'send' : ''}">
            <label class="lyra-exec-field">
              <span class="lyra-rich-label">${escapeHtml(panel.sourceChainLabel || 'From')}</span>
              ${renderSelect('fromNetwork', defaultFrom, panel.sourceChainOptions)}
            </label>
            ${!panel.showDestinationChain || !panel.destinationChainOptions.length
              ? ''
              : `<label class="lyra-exec-field">
                  <span class="lyra-rich-label">To</span>
                  ${renderSelect('toNetwork', defaultTo, panel.destinationChainOptions)}
                </label>`}
            <label class="lyra-exec-field lyra-exec-amount-field">
              <span class="lyra-rich-label">Amount</span>
              <input class="lyra-exec-input" type="number" step="any" min="0" name="amount" placeholder="0.0" value="${escapeHtml(amount)}">
            </label>
            <label class="lyra-exec-field">
              <span class="lyra-rich-label">${panel.showToToken ? 'From asset' : 'Asset'}</span>
              ${renderSelect('tokenSymbol', selectedToken, panel.tokenOptions)}
            </label>
            ${panel.showToToken
              ? `<label class="lyra-exec-field">
                  <span class="lyra-rich-label">To asset</span>
                  ${renderSelect('toTokenSymbol', selectedToToken, panel.tokenOptions)}
                </label>`
              : ''}
            ${panel.requiresRecipient
              ? `<label class="lyra-exec-field lyra-exec-recipient-field">
                  <span class="lyra-rich-label">Recipient</span>
                  <input class="lyra-exec-input" type="text" name="recipient" placeholder="0x..." value="${escapeHtml(recipient)}">
                </label>`
              : ''}
          </div>
          <div class="lyra-exec-inline-status" data-execution-status></div>
          <div class="lyra-action-row lyra-exec-actions">
            <button class="lyra-chip-link primary" type="submit">${escapeHtml(panel.primaryLabel)}</button>
            <button class="lyra-chip-link secondary" type="button" data-lyra-action="faucet">Get Gas</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function createDecisionRecord(wallet, prompt, directResponse, latestScan = null, metadata = {}) {
  if (!directResponse || typeof directResponse === 'string') return null;
  const confidence = getConfidenceData(latestScan, null);
  return {
    wallet,
    prompt,
    insight: directResponse.text || '',
    reasoning: metadata.reasoning || confidence.reasoning || '',
    confidenceLabel: confidence.label,
    confidenceDetail: confidence.microcopy || confidence.reasoning || '',
    sources: metadata.sources || [],
    actions: metadata.actions || [],
    metadata: {
      html: directResponse.html || null,
      ...metadata
    }
  };
}

function normalizeTokenSymbol(symbol = '') {
  const upper = String(symbol || '').toUpperCase();
  if (upper === 'WETH') return 'ETH';
  if (upper === 'WMNT') return 'MNT';
  return upper;
}

function amountToUnits(amount, decimals = 18) {
  const [wholePart, fractionalPart = ''] = String(amount || '0').trim().split('.');
  const whole = wholePart && /^\d+$/.test(wholePart) ? wholePart : '0';
  const normalizedFraction = `${fractionalPart.replace(/\D/g, '')}${'0'.repeat(decimals)}`.slice(0, decimals);
  const units = (BigInt(whole) * (10n ** BigInt(decimals))) + BigInt(normalizedFraction || '0');
  return units.toString();
}

const L1_STANDARD_BRIDGE_ABI = [
  'function depositETH(uint32 _minGasLimit, bytes _extraData) payable',
  'function depositETHTo(address _to, uint32 _minGasLimit, bytes _extraData) payable',
  'function depositMNT(uint256 _amount, uint32 _minGasLimit, bytes _extraData)',
  'function depositMNTTo(address _to, uint256 _amount, uint32 _minGasLimit, bytes _extraData)',
  'function depositERC20(address _l1Token, address _l2Token, uint256 _amount, uint32 _minGasLimit, bytes _extraData)',
  'function depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _minGasLimit, bytes _extraData)'
];

const L2_STANDARD_BRIDGE_ABI = [
  'function withdraw(address _l2Token, uint256 _amount, uint32 _l1Gas, bytes _data)',
  'function withdrawTo(address _l2Token, address _to, uint256 _amount, uint32 _l1Gas, bytes _data)'
];

const MANTLE_SEPOLIA_BRIDGE_CONSTANTS = {
  L1_STANDARD_BRIDGE: '0x21F308067241B2028503c07bd7cB3751FFab0Fb2',
  L2_STANDARD_BRIDGE: '0x4200000000000000000000000000000000000010',
  BVM_ETH: '0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111',
  L1_MNT: '0x6900000000000000000000000000000000000020'
};

const l1StandardBridgeInterface = new ethers.Interface(L1_STANDARD_BRIDGE_ABI);
const l2StandardBridgeInterface = new ethers.Interface(L2_STANDARD_BRIDGE_ABI);

function toHexQuantity(value) {
  const normalized = typeof value === 'bigint' ? value : BigInt(value || 0);
  return `0x${normalized.toString(16)}`;
}

function getMantleSepoliaContracts() {
  return {
    l1: {
      L1StandardBridge: MANTLE_SEPOLIA_BRIDGE_CONSTANTS.L1_STANDARD_BRIDGE
    }
  };
}

function isMantleCanonicalBridgePair(fromChain, toChain) {
  const pair = `${fromChain?.chainId || ''}:${toChain?.chainId || ''}`;
  return pair === '11155111:5003' || pair === '5003:11155111';
}

function buildMantleCanonicalBridgeIntent(options = {}) {
  const fromChain = options.fromChain;
  const toChain = options.toChain;
  const contracts = getMantleSepoliaContracts();
  const symbol = normalizeTokenSymbol(options.fromTokenSymbol || 'MNT');
  const recipient = options.recipient || options.fromAddress;
  const amount = amountToUnits(options.amount || '0', 18);
  const minGasLimit = 200000;

  if (!contracts?.l1?.L1StandardBridge) {
    throw new Error('Mantle Sepolia bridge contracts are unavailable.');
  }

  const bridgeAddress = contracts.l1.L1StandardBridge;
  const l2BridgeAddress = MANTLE_SEPOLIA_BRIDGE_CONSTANTS.L2_STANDARD_BRIDGE;
  const bvmEthAddress = MANTLE_SEPOLIA_BRIDGE_CONSTANTS.BVM_ETH;
  const l1MntAddress = MANTLE_SEPOLIA_BRIDGE_CONSTANTS.L1_MNT;

  if (amount === '0') {
    throw new Error('Amount must be greater than zero.');
  }

  if (String(fromChain?.chainId) === '11155111' && String(toChain?.chainId) === '5003') {
    if (symbol === 'ETH') {
      const data = recipient && recipient.toLowerCase() !== String(options.fromAddress || '').toLowerCase()
        ? l1StandardBridgeInterface.encodeFunctionData('depositETHTo', [recipient, minGasLimit, '0x'])
        : l1StandardBridgeInterface.encodeFunctionData('depositETH', [minGasLimit, '0x']);
      return {
        type: 'bridge',
        status: 'ready',
        executionKind: 'direct',
        summary: `Bridge route prepared for ${options.amount} ETH.`,
        fromToken: 'ETH',
        toToken: 'ETH',
        fromAmount: options.amount,
        fromTokenAddress: ZERO_ADDRESS,
        fromTokenDecimals: 18,
        toTokenAddress: bvmEthAddress,
        toTokenDecimals: 18,
        approvalAddress: null,
        transactionRequest: {
          to: bridgeAddress,
          data,
          value: toHexQuantity(amount)
        },
        tool: 'Mantle Standard Bridge',
        nextStep: 'Sign the bridge transaction in your wallet.'
      };
    }

    if (symbol === 'MNT') {
      const data = recipient && recipient.toLowerCase() !== String(options.fromAddress || '').toLowerCase()
        ? l1StandardBridgeInterface.encodeFunctionData('depositMNTTo', [recipient, amount, minGasLimit, '0x'])
        : l1StandardBridgeInterface.encodeFunctionData('depositMNT', [amount, minGasLimit, '0x']);
      return {
        type: 'bridge',
        status: 'ready',
        executionKind: 'direct',
        summary: `Bridge route prepared for ${options.amount} MNT.`,
        fromToken: 'MNT',
        toToken: 'MNT',
        fromAmount: options.amount,
        fromTokenAddress: l1MntAddress,
        fromTokenDecimals: 18,
        toTokenAddress: ZERO_ADDRESS,
        toTokenDecimals: 18,
        approvalAddress: bridgeAddress,
        transactionRequest: {
          to: bridgeAddress,
          data,
          value: '0x0'
        },
        tool: 'Mantle Standard Bridge',
        nextStep: 'Sign the token approval if prompted, then sign the bridge transaction.'
      };
    }
  }

  if (String(fromChain?.chainId) === '5003' && String(toChain?.chainId) === '11155111') {
    if (symbol === 'ETH') {
      const data = recipient && recipient.toLowerCase() !== String(options.fromAddress || '').toLowerCase()
        ? l2StandardBridgeInterface.encodeFunctionData('withdrawTo', [bvmEthAddress, recipient, amount, 0, '0x'])
        : l2StandardBridgeInterface.encodeFunctionData('withdraw', [bvmEthAddress, amount, 0, '0x']);
      return {
        type: 'bridge',
        status: 'ready',
        executionKind: 'direct',
        summary: `Bridge route prepared for ${options.amount} ETH.`,
        fromToken: 'ETH',
        toToken: 'ETH',
        fromAmount: options.amount,
        fromTokenAddress: ZERO_ADDRESS,
        fromTokenDecimals: 18,
        toTokenAddress: ZERO_ADDRESS,
        toTokenDecimals: 18,
        approvalAddress: null,
        transactionRequest: {
          to: l2BridgeAddress,
          data,
          value: '0x0'
        },
        tool: 'Mantle Standard Bridge',
        nextStep: 'Sign the withdrawal transaction in your wallet.'
      };
    }

    if (symbol === 'MNT') {
      const data = recipient && recipient.toLowerCase() !== String(options.fromAddress || '').toLowerCase()
        ? l2StandardBridgeInterface.encodeFunctionData('withdrawTo', [ZERO_ADDRESS, recipient, amount, 0, '0x'])
        : l2StandardBridgeInterface.encodeFunctionData('withdraw', [ZERO_ADDRESS, amount, 0, '0x']);
      return {
        type: 'bridge',
        status: 'ready',
        executionKind: 'direct',
        summary: `Bridge route prepared for ${options.amount} MNT.`,
        fromToken: 'MNT',
        toToken: 'MNT',
        fromAmount: options.amount,
        fromTokenAddress: ZERO_ADDRESS,
        fromTokenDecimals: 18,
        toTokenAddress: l1MntAddress,
        toTokenDecimals: 18,
        approvalAddress: null,
        transactionRequest: {
          to: l2BridgeAddress,
          data,
          value: toHexQuantity(amount)
        },
        tool: 'Mantle Standard Bridge',
        nextStep: 'Sign the withdrawal transaction in your wallet.'
      };
    }
  }

  throw new Error(`Mantle canonical bridge does not support ${symbol} on ${fromChain?.label} -> ${toChain?.label}.`);
}

function buildNativeTokenFallback(chain, symbol) {
  return {
    address: ZERO_ADDRESS,
    chainId: chain.chainId,
    symbol,
    decimals: 18,
    name: symbol
  };
}

function buildManualTokenFallback(chain, symbol) {
  const normalized = normalizeTokenSymbol(symbol);
  const manualTokens = {
    '11155111:MNT': {
      address: MANTLE_SEPOLIA_BRIDGE_CONSTANTS.L1_MNT,
      decimals: 18,
      name: 'Mantle'
    },
    '5003:ETH': {
      address: MANTLE_SEPOLIA_BRIDGE_CONSTANTS.BVM_ETH,
      decimals: 18,
      name: 'Bridged Ether'
    },
    '5000:ETH': {
      address: '0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111',
      decimals: 18,
      name: 'Wrapped Ether'
    }
  };

  const entry = manualTokens[`${chain?.chainId || ''}:${normalized}`];
  if (!entry) return null;

  return {
    address: entry.address,
    chainId: Number(chain.chainId),
    symbol: normalized,
    decimals: Number(entry.decimals || 18),
    name: entry.name || normalized
  };
}

async function resolveLifiToken(chain, symbol) {
  const normalized = normalizeTokenSymbol(symbol);
  const nativeSymbol = normalizeTokenSymbol(chain?.nativeSymbol || '');
  try {
    const token = await lifiService.getToken(chain.chainId, normalized);
    if (token?.address) {
      return {
        address: token.address,
        chainId: Number(token.chainId || chain.chainId),
        symbol: normalizeTokenSymbol(token.symbol || normalized),
        decimals: Number(token.decimals || 18),
        name: token.name || normalized
      };
    }
  } catch (_) {}

  if (normalized === nativeSymbol) {
    return buildNativeTokenFallback(chain, normalized);
  }

  const manualFallback = buildManualTokenFallback(chain, normalized);
  if (manualFallback) {
    return manualFallback;
  }

  throw new Error(`${normalized} is not currently available on ${chain.label}.`);
}

async function buildLifiActionIntent(type, options = {}) {
  const fromChain = options.fromChain;
  const toChain = options.toChain || options.fromChain;
  const fromTokenSymbol = normalizeTokenSymbol(options.fromTokenSymbol || 'MNT');
  const requestedToTokenSymbol = normalizeTokenSymbol(options.toTokenSymbol || fromTokenSymbol);
  const amount = String(options.amount || '').trim();

  if (!fromChain?.chainId || !toChain?.chainId) {
    throw new Error('Execution network is not configured correctly.');
  }
  if (!amount) {
    throw new Error('Amount is required.');
  }

  const fromToken = await resolveLifiToken(fromChain, fromTokenSymbol);
  let toToken = null;
  try {
    toToken = await resolveLifiToken(toChain, requestedToTokenSymbol);
  } catch (error) {
    if (type !== 'bridge' || requestedToTokenSymbol === normalizeTokenSymbol(toChain.nativeSymbol || '')) {
      throw error;
    }
    toToken = await resolveLifiToken(toChain, normalizeTokenSymbol(toChain.nativeSymbol || ''));
  }
  const fromAmount = amountToUnits(amount, fromToken.decimals);

  const quote = await lifiService.getQuote({
    fromChain: fromChain.chainId,
    toChain: toChain.chainId,
    fromToken: fromToken.address,
    toToken: toToken.address,
    fromAddress: options.fromAddress,
    fromAmount
  }).catch((error) => {
    throw new Error(error?.message || 'Route quote is unavailable right now.');
  });

  if (!quote?.transactionRequest?.to || !quote?.transactionRequest?.data) {
    throw new Error('Route quote did not include executable transaction data.');
  }

  return {
    type,
    status: 'ready',
    executionKind: 'direct',
    summary: `${type === 'bridge' ? 'Bridge' : 'Swap'} route prepared for ${amount} ${fromToken.symbol}.`,
    fromToken: fromToken.symbol,
    toToken: toToken.symbol,
    fromAmount: amount,
    estimate: quote?.estimate || null,
    action: quote?.action || null,
    tool: 'LI.FI',
    routeId: quote?.id || quote?.routeId || null,
    fromTokenAddress: fromToken.address,
    fromTokenDecimals: fromToken.decimals,
    toTokenAddress: toToken.address,
    toTokenDecimals: toToken.decimals,
    approvalAddress: quote?.estimate?.approvalAddress || null,
    transactionRequest: quote.transactionRequest,
    nextStep: (quote?.estimate?.approvalAddress && fromToken.address !== ZERO_ADDRESS)
      ? 'Sign the token approval if prompted, then sign the route transaction.'
      : 'Sign the route transaction in your wallet.'
  };
}

async function buildMarketTape() {
  const now = Date.now();
  if (marketTapeCache.data && now - marketTapeCache.timestamp < 60_000) {
    return marketTapeCache.data;
  }

  const [prices, chains, protocols, yields] = await Promise.allSettled([
    fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=mantle,ethereum,bitcoin,usd-coin&vs_currencies=usd&include_24hr_change=true'),
    fetchJson('https://api.llama.fi/v2/chains'),
    fetchJson('https://api.llama.fi/protocols'),
    getCachedMantlePools()
  ]);

  const priceData = prices.status === 'fulfilled' ? prices.value : {};
  const chainData = chains.status === 'fulfilled' ? chains.value : [];
  const protocolData = protocols.status === 'fulfilled' ? protocols.value : [];
  const poolData = yields.status === 'fulfilled' ? yields.value || [] : [];

  const mantle = priceData.mantle || {};
  const eth = priceData.ethereum || {};
  const btc = priceData.bitcoin || {};
  const usdc = priceData['usd-coin'] || {};
  const mantleChain = chainData.find((chain) => String(chain.name || '').toLowerCase() === 'mantle');
  const lendle = pickProtocol(protocolData, ['Lendle']);
  const agni = pickProtocol(protocolData, ['Agni Finance', 'Agni']);
  const merchantMoe = pickProtocol(protocolData, ['Merchant Moe']);
  const aaveV3 = pickProtocol(protocolData, ['Aave V3', 'Aave']);
  const stablePool = pickStablePool(poolData);
  const lendingPool = pickTopLendingPool(poolData);
  const lpPool = pickTopLpPool(poolData);
  const mntUsdcPool = pickMntUsdcPool(poolData);

  const items = [
    {
      label: `MNT ${formatUsd(mantle.usd)} ${formatPct(mantle.usd_24h_change)}`,
      tone: Number(mantle.usd_24h_change || 0) >= 0 ? 'up' : 'down'
    },
    {
      label: `ETH ${formatUsd(eth.usd)} ${formatPct(eth.usd_24h_change)}`,
      tone: Number(eth.usd_24h_change || 0) >= 0 ? 'up' : 'down'
    },
    {
      label: `BTC ${formatUsd(btc.usd)} ${formatPct(btc.usd_24h_change)}`,
      tone: Number(btc.usd_24h_change || 0) >= 0 ? 'up' : 'down'
    },
    {
      label: `USDC ${formatUsd(usdc.usd)}`,
      tone: Math.abs(Number(usdc.usd || 1) - 1) < 0.003 ? 'up' : 'warn'
    },
    {
      label: `Mantle TVL ${formatUsd(mantleChain?.tvl, true)}`,
      title: 'Mantle TVL',
      value: formatUsd(mantleChain?.tvl, true),
      detail: 'Network capital base',
      tone: 'neutral'
    },
    {
      label: `Lendle TVL ${formatUsd(lendle?.tvl, true)}`,
      tone: 'neutral'
    },
    {
      label: `Agni liquidity ${formatUsd(agni?.tvl, true)}`,
      tone: 'neutral'
    },
    {
      label: `Merchant Moe liquidity ${formatUsd(protocolMantleTvl(merchantMoe), true)}`,
      title: 'Merchant Moe Liquidity',
      value: formatUsd(protocolMantleTvl(merchantMoe), true),
      detail: 'Visible liquidity depth',
      tone: 'neutral'
    },
    {
      label: stablePool ? `Stablecoin route APY ${Number(stablePool.apy).toFixed(1)}%` : null,
      title: stablePool ? 'Top Stable APY' : null,
      value: stablePool ? `${Number(stablePool.apy).toFixed(1)}%` : null,
      detail: stablePool ? `${stablePool.project || 'Mantle route'} ${stablePool.symbol || ''}`.trim() : null,
      tone: stablePool ? 'up' : 'neutral'
    },
    {
      label: lendingPool ? `Top lending APY ${Number(lendingPool.apy).toFixed(1)}%` : null,
      title: lendingPool ? 'Top Lending APY' : null,
      value: lendingPool ? `${Number(lendingPool.apy).toFixed(1)}%` : null,
      detail: lendingPool ? `${lendingPool.project || 'Mantle route'} ${lendingPool.symbol || ''}`.trim() : null,
      tone: lendingPool ? 'up' : 'neutral'
    },
    {
      label: lpPool ? `Top LP APY ${Number(lpPool.apy).toFixed(1)}%` : null,
      title: lpPool ? 'Top LP APY' : null,
      value: lpPool ? `${Number(lpPool.apy).toFixed(1)}%` : null,
      detail: lpPool ? `${lpPool.project || 'Mantle LP'} ${lpPool.symbol || ''}`.trim() : null,
      tone: lpPool ? 'up' : 'neutral'
    },
    {
      label: aaveV3 ? `Aave V3 TVL ${formatUsd(protocolMantleTvl(aaveV3), true)}` : null,
      title: aaveV3 ? 'Aave V3 TVL' : null,
      value: aaveV3 ? formatUsd(protocolMantleTvl(aaveV3), true) : null,
      detail: aaveV3 ? 'Protocol depth on Mantle' : null,
      tone: 'neutral'
    },
    {
      label: mntUsdcPool ? `MNT/USDC route APY ${Number(mntUsdcPool.apy).toFixed(1)}%` : null,
      tone: mntUsdcPool ? 'up' : 'neutral'
    }
  ];

  const data = {
    ok: true,
    source: ['CoinGecko', 'DefiLlama'],
    updatedAt: new Date().toISOString(),
    items: items.filter((item) => item.label && !item.label.includes('--'))
  };

  marketTapeCache = { timestamp: now, data };
  return data;
}

async function handleMarketTape(req, res) {
  try {
    return sendJson(res, 200, await buildMarketTape());
  } catch (error) {
    return sendJson(res, 200, {
      ok: false,
      error: error.message,
      source: ['CoinGecko', 'DefiLlama'],
      updatedAt: new Date().toISOString(),
      items: [
        { label: 'MNT price syncing', tone: 'neutral' },
        { label: 'ETH price syncing', tone: 'neutral' },
        { label: 'BTC price syncing', tone: 'neutral' },
        { label: 'Mantle TVL syncing', tone: 'neutral' }
      ]
    });
  }
}

async function buildPortfolioSnapshot(userAddress) {
  const [snapshot, history] = await Promise.all([
    portfolioContext.buildSnapshot(userAddress, { lendle }),
    walletHistory.isConfigured()
      ? walletHistory.buildWalletIntelligence(userAddress).catch((error) => ({ error: error.message }))
      : Promise.resolve({ error: 'COVALENT_API_KEY is not configured' })
  ]);

  if (snapshot) {
    snapshot.history = history;
  }

  return snapshot;
}

function normalizeOpportunityPools(pools = []) {
  const seen = new Set();
  return pools.filter((pool) => {
    const key = `${pool?.project || ''}:${pool?.symbol || ''}:${pool?.poolMeta || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function opportunityRiskExplanation(pool, display) {
  const symbol = String(pool?.symbol || '').toUpperCase();
  const category = String(display?.category || '').toLowerCase();
  if (/USDC|USDT|USDE|DAI|USDY/.test(symbol)) {
    return 'More defensive than directional routes, but yield can compress and protocol risk still matters.';
  }
  if (category.includes('lend') || category.includes('supply')) {
    return 'Simpler route structure, but sustainability still depends on protocol health and utilization staying healthy.';
  }
  if (category.includes('lp') || category.includes('liquidity')) {
    return 'Higher operational risk because returns depend on pair behavior, liquidity depth, and exit conditions.';
  }
  return 'More directional than pure stable routes, so users should expect more movement than a defensive income posture.';
}

function opportunityFitLabel(pool, display) {
  const symbol = String(pool?.symbol || '').toUpperCase();
  const category = String(display?.category || '').toLowerCase();
  if (/USD/.test(symbol)) return 'Best for defensive stable deployment';
  if (/ETH|METH/.test(symbol)) return 'Best for productive ETH-linked exposure';
  if (category.includes('lend') || category.includes('supply')) return 'Best for simpler capital deployment';
  if (category.includes('lp') || category.includes('liquidity')) return 'Best for higher-yield LP hunting';
  return 'Best for monitored Mantle deployment';
}

function opportunityLensReason(lens, pool, display) {
  switch (lens) {
    case 'defensive':
      return 'Ranks here because the route leans steadier than directional pairs and is easier to defend in a capital-preservation pitch.';
    case 'yield':
      return 'Ranks here because headline APY leads the visible Mantle board while TVL still clears the minimum durability filter.';
    case 'simple':
      return 'Ranks here because the route is easier to explain and enter than more complex LP-heavy choices.';
    default:
      return `Ranks here because ${display.name} combines usable APY with enough visible TVL to treat the route as actionable rather than decorative.`;
  }
}

function opportunityReadiness(display) {
  const supports = Array.isArray(display?.supports) ? display.supports : [];
  if (supports.includes('supply') || supports.includes('lp')) {
    return {
      label: 'Bridge / swap prep available',
      detail: 'LYRA can prepare the bridge and token conversion. Final deposit still happens on the protocol.'
    };
  }
  if (supports.includes('swap')) {
    return {
      label: 'Swap prep available',
      detail: 'LYRA can prepare the asset conversion, then hand off to the protocol path.'
    };
  }
  return {
    label: 'Research only',
    detail: 'This route is sourced and ranked, but LYRA is not exposing direct entry prep for it yet.'
  };
}

function buildOpportunityActions(display, readiness) {
  const actions = [
    {
      type: 'prompt',
      label: 'Ask LYRA why',
      prompt: `Why is ${display.name} ranked as a Mantle opportunity right now?`,
      variant: 'secondary'
    },
    display.appUrl ? {
      type: 'link',
      label: `Open ${display.name}`,
      url: display.appUrl,
      variant: 'primary'
    } : null,
    display.docsUrl ? {
      type: 'link',
      label: 'Docs',
      url: display.docsUrl,
      variant: 'secondary'
    } : null,
    readiness.label.startsWith('Bridge') ? {
      type: 'action',
      label: 'Prepare Bridge',
      action: 'bridge',
      variant: 'secondary'
    } : null,
    readiness.label.includes('swap') || readiness.label.includes('Swap') ? {
      type: 'action',
      label: 'Prepare Swap',
      action: 'swap',
      variant: 'secondary'
    } : null
  ].filter(Boolean);

  return actions.slice(0, 4);
}

function mapOpportunityCard(pool, lens = 'overall') {
  const display = getProtocolDisplay(pool);
  const readiness = opportunityReadiness(display);
  return {
    protocol: display.name,
    symbol: pool?.symbol || '--',
    category: display.category,
    network: 'Mantle',
    placementLabel: mantlePlacementLabel(pool),
    placementExplanation: mantlePlacementExplanation(pool),
    apy: Number(pool?.apy || 0),
    tvlUsd: Number(pool?.tvlUsd || 0),
    fit: opportunityFitLabel(pool, display),
    riskLevel: display.risk,
    riskExplanation: opportunityRiskExplanation(pool, display),
    reason: opportunityLensReason(lens, pool, display),
    readiness,
    links: [
      display.appUrl ? { label: 'Protocol', url: display.appUrl } : null,
      display.docsUrl ? { label: 'Docs', url: display.docsUrl } : null,
      display.sourceUrl ? { label: 'Source', url: display.sourceUrl } : null
    ].filter(Boolean),
    actions: buildOpportunityActions(display, readiness)
  };
}

function pickOpportunityByLens(pools = [], lens = 'overall') {
  if (!pools.length) return null;
  if (lens === 'yield') return pools.slice().sort((a, b) => Number(b.apy || 0) - Number(a.apy || 0))[0] || null;
  if (lens === 'defensive') {
    return pools.find((pool) => /USDC|USDT|USDE|DAI|USDY/i.test(String(pool?.symbol || '')))
      || pools.find((pool) => String(getProtocolDisplay(pool).risk).toLowerCase() === 'lower')
      || null;
  }
  if (lens === 'simple') {
    return pools.find((pool) => {
      const supports = getProtocolDisplay(pool).supports || [];
      return supports.includes('supply');
    }) || pools.find((pool) => String(getProtocolDisplay(pool).risk).toLowerCase() === 'lower') || null;
  }
  return pools[0] || null;
}

function pickUniqueOpportunityByLens(pools = [], lens = 'overall', used = new Set()) {
  const ordered = lens === 'yield'
    ? pools.slice().sort((a, b) => Number(b.apy || 0) - Number(a.apy || 0))
    : lens === 'defensive'
      ? [
          ...pools.filter((pool) => /USDC|USDT|USDE|DAI|USDY/i.test(String(pool?.symbol || ''))),
          ...pools.filter((pool) => String(getProtocolDisplay(pool).risk).toLowerCase() === 'lower'),
          ...pools
        ]
      : lens === 'simple'
        ? [
            ...pools.filter((pool) => {
              const supports = getProtocolDisplay(pool).supports || [];
              return supports.includes('supply');
            }),
            ...pools.filter((pool) => String(getProtocolDisplay(pool).risk).toLowerCase() === 'lower'),
            ...pools
          ]
        : pools;

  for (const pool of ordered) {
    const key = `${pool?.project || ''}:${pool?.symbol || ''}:${pool?.poolMeta || ''}`;
    if (used.has(key)) continue;
    used.add(key);
    return pool;
  }
  return null;
}

function buildOpportunityHighlight(label, pool, lens) {
  if (!pool) return null;
  const display = getProtocolDisplay(pool);
  return {
    label,
    protocol: display.name,
    symbol: pool?.symbol || '--',
    placementLabel: mantlePlacementLabel(pool),
    apy: Number(pool?.apy || 0),
    tvlUsd: Number(pool?.tvlUsd || 0),
    reason: opportunityLensReason(lens, pool, display)
  };
}

function buildFallbackMantlePools() {
  return [
    {
      project: 'Clearpool',
      symbol: 'USDC',
      poolMeta: 'Credit / Lending',
      chain: 'Mantle',
      apy: 12.52,
      tvlUsd: 13058
    },
    {
      project: 'Aave V3',
      symbol: 'USDC',
      poolMeta: 'Lending',
      chain: 'Mantle',
      apy: 6.05,
      tvlUsd: 1600000
    },
    {
      project: 'Merchant Moe',
      symbol: 'USDT-ETH',
      poolMeta: 'LP',
      chain: 'Mantle',
      apy: 29.74,
      tvlUsd: 619400
    },
    {
      project: 'Lendle',
      symbol: 'GHO',
      poolMeta: 'Lending',
      chain: 'Mantle',
      apy: 6.51,
      tvlUsd: 4000000
    }
  ];
}

async function buildLiveOpportunitiesPayload() {
  const livePools = await getCachedMantlePools();
  const mantlePools = livePools.length ? livePools : buildFallbackMantlePools();

  const used = new Set();
  const bestOverall = pickUniqueOpportunityByLens(mantlePools, 'overall', used) || mantlePools[0] || null;
  const bestDefensive = pickUniqueOpportunityByLens(mantlePools, 'defensive', used) || pickOpportunityByLens(mantlePools, 'defensive') || bestOverall;
  const bestYield = pickUniqueOpportunityByLens(mantlePools, 'yield', used) || pickOpportunityByLens(mantlePools, 'yield') || bestOverall;
  const bestSimple = pickUniqueOpportunityByLens(mantlePools, 'simple', used) || pickOpportunityByLens(mantlePools, 'simple') || bestOverall;

  const highlights = [
    buildOpportunityHighlight('Best Overall', bestOverall, 'overall'),
    buildOpportunityHighlight('Best Defensive', bestDefensive, 'defensive'),
    buildOpportunityHighlight('Best Yield', bestYield, 'yield'),
    buildOpportunityHighlight('Best Simple Deploy', bestSimple, 'simple')
  ].filter(Boolean);

  const cards = [
    { pool: bestOverall, lens: 'overall' },
    { pool: bestDefensive, lens: 'defensive' },
    { pool: bestYield, lens: 'yield' },
    { pool: bestSimple, lens: 'simple' }
  ]
    .filter((entry) => entry.pool)
    .map((entry, index) => ({
      rank: index + 1,
      ...mapOpportunityCard(entry.pool, entry.lens)
    }));

  const topCard = cards[0] || null;
  const mantleNativeRoutes = mantlePools.filter((pool) => mantlePlacementLabel(pool) === 'Mantle-native').length;
  const availableRoutes = Math.max(mantlePools.length - mantleNativeRoutes, 0);

  return {
    ok: true,
    title: 'Live Opportunities',
    summary: livePools.length
      ? 'Ranked routes available on Mantle using APY, TVL durability, route clarity, and action readiness. LYRA labels what is Mantle-native versus what is simply available on Mantle. APY is annualized, not monthly.'
      : 'Live Mantle pool data is thin right now, so LYRA is showing a curated Mantle featured board from the last known good routes. APY is annualized, not monthly.',
    checkedAt: new Date().toISOString(),
    highlights,
    cards,
    stats: {
      visibleRoutes: livePools.length || mantlePools.length,
      mantleNativeRoutes,
      availableRoutes
    },
    methodology: [
      'Available on Mantle routes included',
      'Mantle-native versus available-on-Mantle labeled separately',
      'APY is annualized, not monthly',
      'Frozen routes removed',
      'TVL used as first durability check',
      'Action readiness shown separately from research quality'
    ],
    recommendation: topCard ? {
      title: `${topCard.protocol} is the strongest visible route on Mantle right now.`,
      copy: `Start there only if the asset and risk posture match the user. If not, use the defensive route first and let LYRA prepare the bridge or swap path instead of chasing the loudest APY.`
    } : null,
    confidence: livePools.length ? 'Live Mantle route board' : 'Cached Mantle route board',
    sources: 'Sources: DefiLlama, protocol sources'
  };
}

async function handleLiveOpportunities(req, res) {
  try {
    const payload = await buildLiveOpportunitiesPayload();
    return sendJson(res, 200, payload);
  } catch (error) {
    const fallbackPools = buildFallbackMantlePools();
    const fallbackCards = fallbackPools.slice(0, 4).map((pool, index) => ({
      rank: index + 1,
      ...mapOpportunityCard(pool, index === 0 ? 'overall' : index === 1 ? 'defensive' : index === 2 ? 'yield' : 'simple')
    }));
    return sendJson(res, 200, {
      ok: true,
      title: 'Live Opportunities',
      summary: 'Live Mantle data is temporarily thin, so LYRA is falling back to a stable featured board instead of showing an empty state.',
      checkedAt: new Date().toISOString(),
      highlights: [],
      cards: fallbackCards,
      stats: {
        visibleRoutes: fallbackPools.length,
        mantleNativeRoutes: fallbackPools.filter((pool) => mantlePlacementLabel(pool) === 'Mantle-native').length,
        availableRoutes: fallbackPools.filter((pool) => mantlePlacementLabel(pool) !== 'Mantle-native').length
      },
      methodology: [
        'Fallback Mantle featured routes shown instead of blank space',
        'Available on Mantle routes included',
        'APY is annualized, not monthly',
        'Action readiness kept separate from route quality'
      ],
      recommendation: fallbackCards[0] ? {
        title: `${fallbackCards[0].protocol} is the strongest fallback route on Mantle right now.`,
        copy: 'LYRA is preserving a readable board while live upstream data refreshes.'
      } : null,
      confidence: 'Fallback Mantle route board',
      sources: 'Sources: DefiLlama, protocol sources',
      error: error.message
    });
  }
}

async function buildAlchemyChainFallback(address) {
  const apiKey = process.env.ALCHEMY_API_KEY || null;
  if (!apiKey) return [];
  const results = await Promise.allSettled(
    ALCHEMY_VISIBILITY_NETWORKS.map(async ({ network, label }) => {
      const service = new AlchemyService({ apiKey, network });
      const [oldestActivityAt, recentTransactions] = await Promise.all([
        service.getOldestTransactionTimestamp(address).catch(() => null),
        service.getRecentTransactions(address, 12).catch(() => [])
      ]);
      const transactionCount = (recentTransactions || []).reduce((total, tx) => total + Number(tx.count || 1), 0);
      if (!oldestActivityAt && transactionCount <= 0) {
        return null;
      }
      return {
        chainLabel: label,
        transactionCount: transactionCount > 0 ? transactionCount : 1,
        oldestActivityAt
      };
    })
  );

  return results
    .filter((result) => result.status === 'fulfilled' && result.value)
    .map((result) => result.value);
}

function parseNansenTimestamp(entry) {
  return entry?.block_time
    || entry?.blockTime
    || entry?.block_timestamp
    || entry?.blockTimestamp
    || entry?.timestamp
    || entry?.time
    || entry?.date
    || null;
}

function normalizeNansenChain(entry) {
  return entry?.chain
    || entry?.chain_name
    || entry?.network
    || entry?.chainName
    || entry?.chain_id
    || entry?.chainId
    || null;
}

function titleCaseChain(value) {
  return String(value || '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function summarizeNansenHistory(entries = []) {
  const chainCounter = new Map();
  let oldestActivityAt = null;

  entries.forEach((entry) => {
    const chain = titleCaseChain(normalizeNansenChain(entry));
    if (chain) {
      chainCounter.set(chain, (chainCounter.get(chain) || 0) + 1);
    }
    const timestamp = parseNansenTimestamp(entry);
    if (timestamp) {
      const iso = new Date(timestamp).toISOString();
      if (!oldestActivityAt || new Date(iso).getTime() < new Date(oldestActivityAt).getTime()) {
        oldestActivityAt = iso;
      }
    }
  });

  const chainActivity = Array.from(chainCounter.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([chainLabel, transactionCount]) => ({
      chainLabel,
      transactionCount,
      oldestActivityAt
    }));

  return {
    oldestActivityAt,
    transactionCount: entries.length,
    chainActivity
  };
}

function detectHistoryCoverage(chainActivity = [], hasNansen = false, hasCovalent = false) {
  const chains = chainActivity.filter((entry) => entry?.chainLabel).map((entry) => entry.chainLabel);
  if (chains.length > 1) return `${chains.length} chains visible`;
  if (chains.length === 1) return hasNansen || hasCovalent ? `${chains[0]}-focused` : `${chains[0]}-only`;
  if (hasNansen || hasCovalent) return 'Cross-chain limited';
  return 'Limited';
}

function determineObservedSince(oldestActivityAt) {
  if (!oldestActivityAt) return 'Unknown';
  const date = new Date(oldestActivityAt);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString('en-GB', {
    month: 'short',
    year: 'numeric'
  });
}

function extractAmountAndSymbol(message = '') {
  const match = String(message).match(/(\d+(?:\.\d+)?)\s*([a-zA-Z]{2,8})?/);
  if (!match) return { amount: null, tokenSymbol: null };
  return {
    amount: match[1],
    tokenSymbol: match[2] ? match[2].toUpperCase() : null
  };
}

function formatRelativeTime(iso) {
  if (!iso) return 'Unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

async function runWalletScan(walletAddress) {
  const [alchemyBalancesResult, recentTransactionsResult, oldestActivityResult, portfolioResult, chainActivityResult, tokenDistributionResult, nansenTransactionsResult] = await Promise.allSettled([
    alchemyService.getWalletBalances(walletAddress),
    alchemyService.getRecentTransactions(walletAddress, 25),
    alchemyService.getOldestTransactionTimestamp(walletAddress),
    covalentService.getPortfolio(walletAddress),
    covalentService.getChainActivity(walletAddress),
    covalentService.getTokenDistribution(walletAddress),
    nansenService.getAddressTransactions(walletAddress, { chains: 'all', limit: 250 })
  ]);

  const alchemyBalances = alchemyBalancesResult.status === 'fulfilled' ? alchemyBalancesResult.value : { network: 'mantle-mainnet', nativeBalance: null, tokenHoldings: [] };
  const recentTransactions = recentTransactionsResult.status === 'fulfilled' ? recentTransactionsResult.value : [];
  const portfolio = portfolioResult.status === 'fulfilled' ? portfolioResult.value : [];
  const covalentChainActivity = chainActivityResult.status === 'fulfilled' ? chainActivityResult.value : [];
  const nansenTransactions = nansenTransactionsResult.status === 'fulfilled' ? nansenTransactionsResult.value : [];
  const tokenDistribution = tokenDistributionResult.status === 'fulfilled'
    ? tokenDistributionResult.value
    : { totalValueUsd: 0, holdings: [], stablecoins: [], stablecoinValueUsd: 0 };
  const nansenHistory = summarizeNansenHistory(nansenTransactions);
  const alchemyChainFallback = (!covalentChainActivity.length || covalentChainActivity.every((entry) => Number(entry.transactionCount || 0) <= 0))
    ? await buildAlchemyChainFallback(walletAddress)
    : [];
  const chainActivity = covalentChainActivity.length
    ? covalentChainActivity
    : (nansenHistory.chainActivity.length ? nansenHistory.chainActivity : alchemyChainFallback);

  const analysis = analyzeWalletIntelligence({
    alchemyBalances,
    recentTransactions,
    portfolio,
    chainActivity,
    tokenDistribution
  });

  const oldestCandidates = [
    oldestActivityResult.status === 'fulfilled' ? oldestActivityResult.value : null,
    ...(recentTransactions || []).map((tx) => tx?.blockSignedAt || tx?.metadata?.blockTimestamp || null),
    ...alchemyChainFallback.map((entry) => entry.oldestActivityAt || null),
    nansenHistory.oldestActivityAt
  ].filter(Boolean);
  const oldestActivityAt = oldestCandidates
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] || null;

  if (nansenHistory.transactionCount > Number(analysis.transactionCount || 0)) {
    analysis.transactionCount = nansenHistory.transactionCount;
  }
  if (nansenHistory.chainActivity.length) {
    const mergedChains = new Set([
      ...(analysis.activeChains || []),
      ...nansenHistory.chainActivity.map((entry) => entry.chainLabel).filter(Boolean)
    ]);
    analysis.activeChains = Array.from(mergedChains);
    const nansenDominantChain = nansenHistory.chainActivity[0]?.chainLabel || null;
    if (nansenDominantChain && (!analysis.dominantChain || analysis.dominantChain === 'Mantle')) {
      analysis.dominantChain = nansenDominantChain;
    }
  }
  analysis.oldestActivityAt = oldestActivityAt;
  analysis.historyCoverage = detectHistoryCoverage(
    nansenHistory.chainActivity.length ? nansenHistory.chainActivity : chainActivity,
    nansenService.isConfigured() && nansenHistory.transactionCount > 0,
    covalentChainActivity.length > 0
  );
  if (analysis.historyCoverage === 'Limited' && Array.isArray(analysis.activeChains) && analysis.activeChains.length === 1) {
    analysis.historyCoverage = `${analysis.activeChains[0]}-only`;
  }
  analysis.observedSince = determineObservedSince(oldestActivityAt);
  analysis.lastAnalysisLabel = formatRelativeTime(new Date().toISOString());
  analysis.walletConfidence = analysis.walletConfidence || {};
  analysis.walletConfidence.historySource = nansenHistory.transactionCount > 0
    ? 'Alchemy + Nansen'
    : (covalentChainActivity.length ? 'Alchemy + GoldRush' : 'Alchemy');
  if (
    analysis.walletConfidence.level === 'LOW'
    && Number(analysis.transactionCount || 0) >= 12
    && Array.isArray(analysis.activeChains)
    && analysis.activeChains.length === 1
    && analysis.activeChains[0] === 'Mantle'
  ) {
    analysis.walletConfidence.level = 'MEDIUM';
    analysis.walletConfidence.message = 'Mantle-only history is visible. Cross-chain expansion is currently unavailable, but Mantle activity is readable.';
  }
  if (nansenHistory.transactionCount > Number(analysis.walletConfidence?.evidenceSignals?.transactionsObserved || 0)) {
    analysis.walletConfidence.percent = Math.min(
      100,
      Number(analysis.walletConfidence.percent || 0) + Math.min(18, Math.floor(nansenHistory.transactionCount / 20))
    );
    analysis.walletConfidence.reason = `${analysis.transactionCount} transactions analyzed • ${(analysis.activeChains || []).length} chains detected • ${analysis.walletConfidence.historySource} history support available`;
  }

  if (alchemyBalances?.nativeBalance?.symbol === 'MNT') {
    const nativeAmount = Number(alchemyBalances.nativeBalance.formatted || 0);
    const nativeHolding = analysis.topHoldings?.find((holding) => holding.symbol === 'MNT');
    if (nativeHolding && nativeAmount > 0 && Number(nativeHolding.valueUsd || 0) === 0) {
      try {
        const priceData = await fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=mantle&vs_currencies=usd');
        const mntPrice = Number(priceData?.mantle?.usd || 0);
        if (mntPrice > 0) {
          nativeHolding.valueUsd = Number((nativeAmount * mntPrice).toFixed(2));
          analysis.stablecoinExposure = analysis.stablecoinExposure || {
            valueUsd: 0,
            percentOfVisiblePortfolio: 0,
            visibleSymbols: []
          };
          analysis.walletConfidence.evidenceSignals.visiblePortfolioValueUsd = nativeHolding.valueUsd;
        }
      } catch {
        // Keep the native token amount visible even when pricing is temporarily unavailable.
      }
    }
  }

  const createdAt = saveWalletScan(walletAddress, analysis);

  return {
    walletAddress,
    scannedAt: createdAt,
    oldestActivityAt,
    ...analysis
  };
}

function mapPortfolioForClient(snapshot) {
  if (!snapshot) return null;

  const history = snapshot.history && !snapshot.history.error ? snapshot.history : null;
  const totalValue = history?.totalValue ?? snapshot.portfolioValue?.total ?? 0;
  const balances = history?.balances?.length ? history.balances : Object.entries(snapshot.balances || {}).map(([symbol, balance]) => {
    const breakdown = snapshot.portfolioValue?.breakdown?.[symbol] || {};
    const value = breakdown.value || 0;
    return {
      symbol,
      name: balance.name,
      formatted: balance.formatted,
      raw: balance.raw,
      price: breakdown.price || null,
      value,
      allocationPercent: totalValue > 0 ? (value / totalValue) * 100 : 0
    };
  })
    .filter((asset) => Number(asset.value) > 0 || Number(asset.formatted) > 0)
    .sort((a, b) => b.value - a.value);

  const opportunities = Object.values(snapshot.opportunities || {}).flat().slice(0, 5);
  const topOpportunity = opportunities[0] || null;

  return {
    timestamp: snapshot.timestamp,
    userAddress: snapshot.userAddress,
    network: snapshot.network,
    totalValue,
    balances,
    positions: snapshot.positions || {},
    opportunities,
    history: history ? {
      source: history.source,
      chain: history.chain,
      transactions: history.transactions || [],
      interactions: history.interactions || [],
      summary: history.summary
    } : {
      error: snapshot.history?.error || null,
      transactions: [],
      interactions: [],
      summary: null
    },
    summary: {
      walletStatus: 'Connected',
      previewMode: false,
      networkLabel: snapshot.network === 'mainnet' ? 'Mantle Mainnet' : 'Mantle Testnet',
      nextStep: history?.summary?.nextStep || (balances.length ? 'Run Analyze Wallet for stronger evidence' : 'Fund wallet or connect a different address'),
      recentActivity: history?.summary?.recentActivity || '--',
      riskSignal: history?.summary?.riskSignal || (balances.length ? 'Additional history required' : 'No funded positions'),
      trackedAssets: history?.summary?.trackedAssets ?? balances.length,
      topHolding: history?.summary?.topHolding || balances[0]?.symbol || '--',
      visibilityConfidence: history?.summary?.visibilityConfidence || (balances.length >= 3 ? 'Medium' : 'Low')
    },
    recommendation: topOpportunity ? {
      title: 'Opportunity reads available',
      rationale: 'Protocol yield data is available, but LYRA will not convert it into a wallet recommendation until scan confidence is sufficient.',
      expectedUplift: topOpportunity.apy ? `${topOpportunity.apy}% APY visible` : null,
      risk: 'Unscored',
      actionCount: 0
    } : null
  };
}

async function handlePortfolio(req, res) {
  try {
    const { walletAddress } = await readRequestBody(req);
    if (!walletAddress || !Wallet.isValidAddress(walletAddress)) {
      return sendJson(res, 400, { error: 'Valid walletAddress is required' });
    }
    if (walletAddress.toLowerCase() === ZERO_ADDRESS) {
      return sendJson(res, 400, { error: 'Zero address is not a valid wallet for portfolio analysis' });
    }

    const snapshot = await buildPortfolioSnapshot(walletAddress);
    if (!snapshot) {
      return sendJson(res, 502, { error: 'Failed to build portfolio snapshot' });
    }

    return sendJson(res, 200, { ok: true, snapshot: mapPortfolioForClient(snapshot) });
  } catch (error) {
    console.error('handleActionQuote failed:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

async function handleHistory(req, res) {
  try {
    const { walletAddress } = await readRequestBody(req);
    if (!walletAddress || !Wallet.isValidAddress(walletAddress)) {
      return sendJson(res, 400, { error: 'Valid walletAddress is required' });
    }
    if (walletAddress.toLowerCase() === ZERO_ADDRESS) {
      return sendJson(res, 400, { error: 'Zero address is not a valid wallet for history analysis' });
    }
    if (!walletHistory.isConfigured()) {
      return sendJson(res, 503, { error: 'COVALENT_API_KEY is not configured' });
    }

    const history = await walletHistory.buildWalletIntelligence(walletAddress);
    return sendJson(res, 200, { ok: true, history });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

async function buildDirectLyraResponse(message, snapshot, latestScan = null) {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();
  const balances = snapshot?.balances || [];
  const totalValue = Number(snapshot?.totalValue || 0);
  const historyTxs = snapshot?.history?.transactions || [];
  const usdcHolding = balances.find((asset) => String(asset.symbol || '').toUpperCase() === 'USDC');
  const bridge = protocolRegistry.getById('mantle-bridge');
  const faucet = protocolRegistry.getById('mantle-faucet');

  if (/^(hi|hello|hey|yo|gm|good morning|good afternoon|good evening)\b/i.test(lower)) {
    return {
      text: snapshot
        ? 'Hey. Wallet context is live. Ask about opportunities, wallet behavior, or bridge, swap, and send support.'
        : 'Hey. Ask about Mantle opportunities, protocol comparisons, or connect a wallet for wallet-aware answers.',
      reasoning: 'Greeting response.',
      sources: [],
      actions: []
    };
  }

  if (/^(how are you|how are you doing|how's it going|hows it going|what's up|whats up)[\s!.?]*$/i.test(lower)) {
    return {
      text: snapshot
        ? 'I am good. Wallet context is already loaded, so we can go straight into opportunities, comparisons, or execution prep.'
        : 'I am good. We can go straight into Mantle opportunities, comparisons, or connect a wallet for a live read.',
      reasoning: 'Fast casual response.',
      sources: [],
      actions: []
    };
  }

  if (/^(thanks|thank you|nice|cool|great)[\s!.?]*$/i.test(lower)) {
    return {
      text: 'Anytime. Keep going.',
      reasoning: 'Fast acknowledgement.',
      sources: [],
      actions: []
    };
  }

  if (/^(what can you do|what do you do|who are you|tell me about lyra|introduce yourself|help|how does this work|how does lyra work|what is lyra|give me an overview|give me a quick intro)\b/i.test(lower)) {
    return {
      text: snapshot
        ? 'LYRA ranks Mantle opportunities, explains wallet activity in plain language, and prepares bridge, swap, or send flows when the action is supported.'
        : 'LYRA ranks Mantle opportunities, explains wallet activity in plain language, and prepares bridge, swap, or send flows when the action is supported. Connect a wallet for wallet-aware answers.',
      reasoning: 'Fast intro response.',
      sources: [],
      actions: [
        { label: 'Show opportunities', url: 'lyra-action:opportunities', primary: true },
        { label: 'Prepare Bridge', url: 'lyra-action:bridge', primary: false }
      ]
    };
  }

  const mantlePools = await getCachedMantlePools();

  if (lower.includes('2-step mantle strategy') || lower.includes('turn my current wallet')) {
    const topRoutes = preferRegistryBackedPools(mantlePools, 2);
    const lead = topRoutes[0];
    const leadDisplay = lead ? getProtocolDisplay(lead) : null;
    const visibleHolding = balances[0];
    const dominantNetwork = latestScan?.dominantChain || snapshot?.summary?.networkLabel || 'Mantle context still building';
    return {
      text: leadDisplay
        ? `${leadDisplay.name} is the clearest first route right now, but the wallet should stay simple: fund Mantle cleanly, then deploy only into one visible route.`
        : 'The cleanest 2-step strategy right now is to fund Mantle first, then deploy only after a strong live route is visible.',
      html: renderPlanResponse({
        title: 'Two-step Mantle plan',
        answer: leadDisplay
          ? `${leadDisplay.name} is the clearest first route right now, but the wallet should stay simple: fund Mantle cleanly, then deploy only into one visible route.`
          : 'The cleanest 2-step strategy right now is to fund Mantle first, then deploy only after a strong live route is visible.',
        steps: [
          {
            title: 'Make Mantle the funded base',
            copy: 'Keep the first move simple: make sure the wallet has usable Mantle-side gas and deployable capital before chasing a route.',
            points: [
              `Dominant visible network: ${dominantNetwork}`,
              totalValue > 0 ? `Visible wallet value: ${formatUsd(totalValue)}` : 'Visible funded value is still limited.',
              visibleHolding ? `Largest visible holding: ${visibleHolding.symbol}` : 'No clear lead holding yet.'
            ]
          },
          {
            title: leadDisplay ? `Deploy into ${leadDisplay.name}` : 'Deploy into the strongest live route',
            copy: lead
              ? `${leadDisplay.name} currently clears the strongest live filter in this scan.`
              : 'Only deploy once the top route is visible and liquid enough to defend.',
            points: lead
              ? [
                  `Visible route: ${leadDisplay.name} — ${lead.symbol}`,
                  `APY: ${Number(lead.apy || 0).toFixed(2)}%`,
                  `TVL: ${formatUsd(lead.tvlUsd, true)}`
                ]
              : ['No live route is visible enough right now to treat as the clear first deployment.']
          }
        ],
        evidence: lead
          ? [
              `${leadDisplay.name} is leading the visible Mantle board after APY and TVL filtering.`,
              'Frozen pools and weak-liquidity routes were removed from the shortlist.'
            ]
          : ['The live route shortlist is too thin right now for a strong first deployment call.'],
        nextStep: leadDisplay
          ? `Use one route only: open ${leadDisplay.name}, review the pair, and deploy only if the capital size actually justifies the move.`
          : 'Wait for a clearer live route, or ask LYRA to rank only stable or only defensive opportunities.',
        actions: [
          leadDisplay?.appUrl ? { label: `Open ${leadDisplay.name}`, url: leadDisplay.appUrl, primary: true } : null,
          { label: 'Prepare Bridge', url: 'lyra-action:bridge', primary: false }
        ].filter(Boolean),
        sources: [
          { label: 'DefiLlama Yields', url: 'https://defillama.com/yields' },
          leadDisplay?.sourceUrl ? { label: `${leadDisplay.name} source`, url: leadDisplay.sourceUrl } : null,
          leadDisplay?.docsUrl ? { label: `${leadDisplay.name} docs`, url: leadDisplay.docsUrl } : null
        ].filter(Boolean),
        latestScan,
        snapshot
      }),
      reasoning: 'The strategy path was reduced to one clean deployment route instead of a long multi-step guess.',
      sources: [
        { label: 'DefiLlama Yields', url: 'https://defillama.com/yields' },
        leadDisplay?.sourceUrl ? { label: `${leadDisplay.name} source`, url: leadDisplay.sourceUrl } : null
      ].filter(Boolean),
      actions: [
        leadDisplay?.appUrl ? { label: `Open ${leadDisplay.name}`, url: leadDisplay.appUrl, primary: true } : null
      ].filter(Boolean)
    };
  }

  if (lower.includes('meth') && lower.includes('usdy')) {
    const mEth = protocolRegistry.getById('meth');
    return {
      text: 'mETH is the better fit when the user still wants ETH-linked upside. USDY is the cleaner fit when defense and steadier income matter more than upside.',
      html: renderComparisonResponse({
        title: 'mETH vs USDY on Mantle',
        answer: 'mETH is the better fit when the user still wants ETH-linked upside. USDY is the cleaner fit when defense and steadier income matter more than upside.',
        left: {
          title: 'mETH',
          copy: 'Best when the user wants productive ETH exposure without fully stepping away from ETH-linked upside.',
          points: [
            'Keeps ETH-linked participation in the mix.',
            'Fits a more directional defensive posture.',
            'Cleaner when the user still wants upside, not pure protection.'
          ],
          links: [
            mEth?.appUrl ? { label: 'Open mETH', url: mEth.appUrl, primary: true } : null,
            mEth?.docsUrl ? { label: 'mETH docs', url: mEth.docsUrl } : null
          ].filter(Boolean)
        },
        right: {
          title: 'USDY',
          copy: 'Best when the user wants steadier income posture and a more defensive story than ETH-linked exposure can offer.',
          points: [
            'Cleaner capital-preservation angle.',
            'Less dependent on ETH direction.',
            'Easier to explain when the goal is defensive income.'
          ],
          links: [
            { label: 'USDY source', url: 'https://ondo.finance/' },
            { label: 'DefiLlama Yields', url: 'https://defillama.com/yields' }
          ]
        },
        verdict: 'Use mETH when upside still matters. Use USDY when the brief is genuinely defensive and the user wants a steadier income posture.',
        nextStep: 'Decide whether this is still an upside-leaning wallet or a defense-first wallet. That choice should drive the allocation before any deployment happens.',
        actions: [
          mEth?.appUrl ? { label: 'Open mETH', url: mEth.appUrl, primary: true } : null,
          { label: 'Prepare Bridge', url: 'lyra-action:bridge', primary: false }
        ].filter(Boolean),
        sources: [
          mEth?.sourceUrl ? { label: 'mETH source', url: mEth.sourceUrl } : null,
          mEth?.docsUrl ? { label: 'mETH docs', url: mEth.docsUrl } : null,
          { label: 'USDY source', url: 'https://ondo.finance/' },
          { label: 'DefiLlama Yields', url: 'https://defillama.com/yields' }
        ].filter(Boolean),
        latestScan,
        snapshot
      }),
      reasoning: 'The comparison was framed as posture selection, not as a fake precise allocation call.',
      sources: [
        mEth?.sourceUrl ? { label: 'mETH source', url: mEth.sourceUrl } : null,
        { label: 'USDY source', url: 'https://ondo.finance/' }
      ].filter(Boolean),
      actions: []
    };
  }

  if (
    lower.includes('top yield opportunit')
    || lower.includes('top earning opportunit')
    || /strongest\s+mantle\s+opportunit/i.test(lower)
    || /mantle\s+opportunit.*right\s+now/i.test(lower)
  ) {
    const top = preferRegistryBackedPools(mantlePools, 3);
    if (!top.length) return { text: 'I could not fetch live Mantle yield routes right now. Try again in a moment.' };
    const lead = getProtocolDisplay(top[0]);
    return {
      text: `${lead.name} currently has the strongest visible Mantle route in this live scan.`,
      html: renderResearchResponse({
        insight: `${lead.name} currently has the strongest visible Mantle route in this live scan.`,
        reasoning: 'I ranked Mantle routes by live APY, removed frozen pools, and used TVL as the first durability check before treating a route as usable.',
        pools: top,
        latestScan,
        snapshot,
        mantleContext: 'This matters on Mantle because lower routing costs make yield rotation more practical than on higher-fee chains, so smaller APY differences can still be actionable.',
        nextStep: 'Start with the top route only if its pair makes sense for your capital and you understand the liquidity profile. Otherwise use the lower-risk stable route as the entry point.',
        actions: [
          { label: `Open ${lead.name}`, url: lead.appUrl, primary: true },
          { label: 'Bridge with LYRA', url: 'lyra-action:bridge', primary: false }
        ].filter(Boolean),
        sources: [
          { label: 'DefiLlama Yields', url: 'https://defillama.com/yields' },
          ...top.map((pool) => {
            const display = getProtocolDisplay(pool);
            return { label: `${display.name} source`, url: display.sourceUrl };
          })
        ]
      }),
      reasoning: 'I ranked Mantle routes by live APY, removed frozen pools, and used TVL as the first durability check before treating a route as usable.',
      sources: [
        { label: 'DefiLlama Yields', url: 'https://defillama.com/yields' },
        ...top.map((pool) => {
          const display = getProtocolDisplay(pool);
          return { label: `${display.name} source`, url: display.sourceUrl };
        })
      ],
      actions: [
        { label: `Open ${lead.name}`, url: lead.appUrl, primary: true },
        bridge?.appUrl ? { label: 'Bridge to Mantle', url: bridge.appUrl } : null
      ].filter(Boolean)
    };
  }

  if (lower.includes('best apy')) {
    const top = preferRegistryBackedPools(mantlePools, 4);
    if (!top.length) return { text: 'I could not fetch Mantle APY data right now.' };
    return {
      text: 'These are the strongest visible APYs on Mantle after quality filtering.',
      html: renderResearchResponse({
        insight: 'These are the strongest visible APYs on Mantle after quality filtering.',
        reasoning: 'I ignored frozen pools and weak-liquidity routes so the list stays closer to something a real user could actually consider.',
        pools: top,
        latestScan,
        snapshot,
        mantleContext: 'A high APY on Mantle is only useful if the route remains liquid enough to enter and exit without friction. Low fees help, but thin depth still matters.',
        nextStep: 'Narrow this to stablecoin-only routes if capital preservation matters more than headline APY.',
        sources: [
          { label: 'DefiLlama Yields', url: 'https://defillama.com/yields' },
          ...top.map((pool) => {
            const display = getProtocolDisplay(pool);
            return { label: `${display.name} source`, url: display.sourceUrl };
          })
        ]
      }),
      reasoning: 'I ignored frozen pools and weak-liquidity routes so the list stays closer to something a real user could actually consider.',
      sources: [
        { label: 'DefiLlama Yields', url: 'https://defillama.com/yields' },
        ...top.map((pool) => {
          const display = getProtocolDisplay(pool);
          return { label: `${display.name} source`, url: display.sourceUrl };
        })
      ],
      actions: []
    };
  }

  if (lower.includes('merchant moe') && lower.includes('agni')) {
    const merchant = mantlePools.find((pool) => String(pool.project || '').toLowerCase().includes('merchant'));
    const agni = mantlePools.find((pool) => String(pool.project || '').toLowerCase().includes('agni'));
    const comparePools = [merchant, agni].filter(Boolean);
    const winner = merchant && agni
      ? (Number(merchant.apy || 0) >= Number(agni.apy || 0) ? getProtocolDisplay(merchant).name : getProtocolDisplay(agni).name)
      : null;
    return {
      text: winner
        ? `${winner} has the stronger visible yield edge right now, but the better route depends on pair quality and liquidity depth.`
        : 'There is no clean live edge between Merchant Moe and Agni right now.',
      html: renderResearchResponse({
        insight: winner
          ? `${winner} has the stronger visible yield edge right now, but the better route depends on pair quality and liquidity depth.`
          : 'There is no clean live edge between Merchant Moe and Agni right now.',
        reasoning: 'Merchant Moe is usually stronger for route breadth and liquidity depth. Agni becomes better when a specific Mantle LP pair shows a clean APY edge with enough TVL behind it.',
        pools: comparePools,
        latestScan,
        snapshot,
        mantleContext: 'This matters on Mantle because both venues are core liquidity surfaces. The right choice depends on whether you need route breadth or a specific LP edge.',
        nextStep: 'Use Merchant Moe when you want broader route liquidity. Use Agni when a specific pair has a visible APY edge and enough depth.',
        extraEvidence: comparePools.length ? [] : ['No live APY was visible for Merchant Moe or Agni in the current scan.'],
        sources: [
          { label: 'DefiLlama Yields', url: 'https://defillama.com/yields' },
          ...comparePools.map((pool) => {
            const display = getProtocolDisplay(pool);
            return { label: `${display.name} source`, url: display.sourceUrl };
          })
        ]
      }),
      reasoning: 'Merchant Moe is usually stronger for route breadth and liquidity depth. Agni becomes better when a specific Mantle LP pair shows a clean APY edge with enough TVL behind it.',
      sources: [
        { label: 'DefiLlama Yields', url: 'https://defillama.com/yields' },
        ...comparePools.map((pool) => {
          const display = getProtocolDisplay(pool);
          return { label: `${display.name} source`, url: display.sourceUrl };
        })
      ],
      actions: []
    };
  }

  if (lower.includes('idle usdc')) {
    const stableRoutes = preferRegistryBackedPools(mantlePools
      .filter((pool) => /USDC|USDT|USDE/i.test(String(pool.symbol || '')))
      , 3);
    const usdcValue = Number(usdcHolding?.value || usdcHolding?.valueUsd || 0);
    return {
      text: usdcValue > 0
        ? 'Visible stablecoin exposure exists. The next step is to compare lower-risk Mantle stable routes before moving capital.'
        : 'No clearly funded USDC position is visible in the current scope, so this is a live route shortlist rather than a wallet-specific move.',
      html: renderResearchResponse({
        insight: usdcValue > 0
          ? 'Visible stablecoin exposure exists. The next step is to compare lower-risk Mantle stable routes before moving capital.'
          : 'No clearly funded USDC position is visible in the current scope, so this is a live route shortlist rather than a wallet-specific move.',
        reasoning: 'For idle stablecoins, the priority is sustainable APY, enough TVL, and pair clarity rather than chasing the highest printed number.',
        pools: stableRoutes,
        latestScan,
        snapshot,
        mantleContext: 'Mantle is relevant here because stable rotation is more practical when fees stay low and routes remain liquid enough to enter and exit.',
        nextStep: usdcValue > 0
          ? 'Start with the top stable route only if you are comfortable with the protocol risk. If not, use the bridge and wait for stronger wallet visibility.'
          : 'Bridge or fund USDC first, then ask again for a wallet-specific stable deployment path.',
        extraEvidence: [`Visible USDC in wallet: ${usdcValue > 0 ? formatUsd(usdcValue) : 'Not clearly funded in current visible scope.'}`],
        actions: stableRoutes[0] ? [{ label: `Open ${getProtocolDisplay(stableRoutes[0]).name}`, url: getProtocolDisplay(stableRoutes[0]).appUrl, primary: true }] : [],
        sources: [
          { label: 'DefiLlama Yields', url: 'https://defillama.com/yields' },
          ...stableRoutes.map((pool) => {
            const display = getProtocolDisplay(pool);
            return { label: `${display.name} source`, url: display.sourceUrl };
          })
        ]
      }),
      reasoning: 'For idle stablecoins, the priority is sustainable APY, enough TVL, and pair clarity rather than chasing the highest printed number.',
      sources: [
        { label: 'DefiLlama Yields', url: 'https://defillama.com/yields' },
        ...stableRoutes.map((pool) => {
          const display = getProtocolDisplay(pool);
          return { label: `${display.name} source`, url: display.sourceUrl };
        })
      ],
      actions: stableRoutes[0] ? [{ label: `Open ${getProtocolDisplay(stableRoutes[0]).name}`, url: getProtocolDisplay(stableRoutes[0]).appUrl, primary: true }] : []
    };
  }

  if (lower.includes('swap')) {
    const parsedIntent = extractAmountAndSymbol(message);
    const fromToken = parsedIntent.tokenSymbol === 'ETH' ? 'ETH' : 'MNT';
    const toToken = fromToken === 'ETH' ? 'MNT' : 'ETH';
    return {
      text: parsedIntent.amount
        ? 'I can do that. Review the swap details below and sign in your wallet.'
        : 'I can do that. Enter the amount below.',
      html: renderExecutionPanel({
        actionType: 'swap',
        amount: parsedIntent.amount,
        tokenSymbol: fromToken,
        toTokenSymbol: toToken,
        fromNetwork: 'Mantle Mainnet',
        note: 'Merchant Moe swap is live on Mantle mainnet for MNT <-> ETH.'
      }),
      reasoning: 'LYRA switched into swap action mode on the supported Mantle mainnet route.',
      sources: [
        { label: 'Merchant Moe contracts', url: 'https://docs.merchantmoe.com/resources/contracts' }
      ],
      actions: []
    };
  }

  if (lower.includes('bridge')) {
    const parsedIntent = extractAmountAndSymbol(message);
    const actionVerb = 'bridge';
    const goingToMantleSepolia = /to\s+mantle\s+sepolia|into\s+mantle\s+sepolia|onto\s+mantle\s+sepolia/i.test(message);
    const goingToSepolia = /to\s+sepolia|into\s+sepolia|onto\s+sepolia/i.test(message) && !goingToMantleSepolia;
    const comingFromMantleSepolia = /from\s+mantle\s+sepolia/i.test(message);
    const requestedFrom = (comingFromMantleSepolia || goingToSepolia)
      ? 'Mantle Sepolia'
      : 'Sepolia';
    const requestedTo = goingToSepolia ? 'Sepolia' : 'Mantle Sepolia';
    const requestedToToken = parsedIntent.tokenSymbol || 'MNT';

    if (!parsedIntent.amount) {
      return {
        text: `I can do that. Enter the amount below.`,
        html: renderExecutionPanel({
          actionType: actionVerb,
          tokenSymbol: parsedIntent.tokenSymbol || 'MNT',
          toTokenSymbol: requestedToToken,
          fromNetwork: requestedFrom,
          toNetwork: requestedTo,
          note: actionVerb === 'bridge'
            ? 'Choose the route and amount, then sign in your wallet.'
            : 'Choose the network, pair, and amount, then sign in your wallet.'
        }),
        reasoning: `LYRA switched into ${actionVerb} action mode.`,
        actions: []
      };
    }
    return {
      text: `I can do that. Review the details below and sign in your wallet.`,
      html: renderExecutionPanel({
        actionType: actionVerb,
        amount: parsedIntent.amount,
        tokenSymbol: parsedIntent.tokenSymbol || 'MNT',
        toTokenSymbol: requestedToToken,
        fromNetwork: requestedFrom,
        toNetwork: requestedTo,
        note: 'Review the route details, then approve the transaction in your wallet.'
      }),
      reasoning: `LYRA switched into ${actionVerb} action mode.`,
      actions: []
    };
  }

  if (lower.includes('send')) {
    const parsedIntent = extractAmountAndSymbol(message);
    const addressMatch = message.match(/0x[a-fA-F0-9]{40}/);
    const requestedNetwork = /mantle\s+mainnet/i.test(message)
      ? 'Mantle Mainnet'
      : /mantle\s+sepolia/i.test(message)
        ? 'Mantle Sepolia'
        : /(?:^|\s)sepolia(?:\s|$)/i.test(message)
        ? 'Sepolia'
        : 'Mantle Sepolia';
    return {
      text: `I can do that. Confirm the details below and sign in your wallet.`,
      html: renderExecutionPanel({
        actionType: 'send',
        amount: parsedIntent.amount,
        tokenSymbol: parsedIntent.tokenSymbol || 'MNT',
        fromNetwork: requestedNetwork,
        recipient: addressMatch ? addressMatch[0] : '',
        note: 'Enter the recipient and amount, then approve the transfer in your wallet.'
      }),
      reasoning: 'LYRA switched into send action mode.',
      actions: []
    };
  }

  if (lower.includes('supply') || lower.includes('lend')) {
    const topStable = mantlePools.find((pool) => /USDC|USDT|USDE/i.test(String(pool.symbol || '')));
    const target = topStable ? getProtocolDisplay(topStable) : protocolRegistry.getById('lendle');
    return {
      text: `${target?.name || 'Lendle'} is the cleanest visible Mantle supply route right now when the goal is straightforward deployment rather than LP complexity.`,
      html: renderResearchResponse({
        insight: `${target?.name || 'Lendle'} is the cleanest visible Mantle supply route right now when the goal is straightforward deployment rather than LP complexity.`,
        reasoning: 'Supply routes are strongest when the user wants simple capital deployment, visible yield, and lower operational complexity than liquidity provision.',
        pools: topStable ? [topStable] : [],
        latestScan,
        snapshot,
        mantleContext: 'This matters on Mantle because a simple supply route is often the fastest way to convert idle stablecoins into productive capital without taking LP-specific risk.',
        nextStep: 'Bridge stablecoins to Mantle if needed, then supply into the visible lower-complexity route before expanding into LP strategies.',
        actions: target?.appUrl ? [{ label: `Supply on ${target.name}`, url: target.appUrl, primary: true }] : [],
        sources: [
          target?.sourceUrl ? { label: `${target.name} source`, url: target.sourceUrl } : null,
          target?.docsUrl ? { label: `${target.name} docs`, url: target.docsUrl } : null
        ].filter(Boolean)
      }),
      reasoning: 'Supply routes are strongest when the user wants simple capital deployment, visible yield, and lower operational complexity than liquidity provision.',
      sources: [
        target?.sourceUrl ? { label: `${target.name} source`, url: target.sourceUrl } : null,
        target?.docsUrl ? { label: `${target.name} docs`, url: target.docsUrl } : null
      ].filter(Boolean),
      actions: [
        target?.appUrl ? { label: `Open ${target.name}`, url: target.appUrl, primary: true } : null
      ].filter(Boolean)
    };
  }

  if (lower.includes('what changed in my portfolio')) {
    const latest = historyTxs.slice(0, 4);
    if (!latest.length) return { text: 'I do not have enough recent wallet history in the current visible scope to describe changes yet.' };
    return {
      text: 'Recent observable wallet activity is available, but the change log is only as strong as the current visible history scope.',
      html: renderResearchResponse({
        insight: 'Recent observable wallet activity is available, but the change log is only as strong as the current visible history scope.',
        reasoning: 'I am describing only directly visible changes. I am not inferring hidden cross-chain moves unless the wallet history actually shows them.',
        latestScan,
        snapshot,
        mantleContext: 'This matters on Mantle because a partial history can hide the real source of funds or the real strategy behind the recent transactions.',
        nextStep: 'Use this as a directional read only. For stronger change tracking, expand visible history or reconnect with a wallet that has clearer funded activity.',
        extraEvidence: latest.map((tx, index) => `${index + 1}. ${(tx.txType || 'Transaction')} on ${tx.chain || 'observed chain'}${tx.protocol ? ` via ${tx.protocol}` : ''}`),
        sources: [{ label: 'Wallet Activity', url: 'https://www.alchemy.com/' }]
      }),
      reasoning: 'I am describing only directly visible changes. I am not inferring hidden cross-chain moves unless the wallet history actually shows them.',
      sources: [{ label: 'Wallet Activity', url: 'https://www.alchemy.com/' }],
      actions: []
    };
  }

  if (/^(hi|hey|hello|yo|gm|good morning|good evening)[\s!.]*$/i.test(lower)) {
    return {
      text: 'I am here. Ask me to compare Mantle yields, prepare a bridge or send, or scan what changed in your wallet.',
      reasoning: 'Conversational greeting. No wallet conclusion needed.',
      sources: [],
      actions: [
        { label: 'Prepare Bridge', url: 'lyra-action:bridge', primary: true }
      ]
    };
  }

  if (lower.includes('most important thing about my wallet')) {
    const topHolding = balances[0];
    return {
      text: 'The main constraint right now is evidence coverage, not opportunity count.',
      html: renderResearchResponse({
        insight: 'The main constraint right now is evidence coverage, not opportunity count.',
        reasoning: 'A weak evidence base leads to weak recommendations. It is better to state that the scan is partial than to act certain from incomplete visibility.',
        latestScan,
        snapshot,
        mantleContext: 'Mantle opportunities become meaningful only when the wallet context is strong enough to tell whether the route fits the actual capital and behavior pattern.',
        nextStep: 'Use the current view as a directional research layer. Strengthen the history coverage, then re-run the opportunity questions for sharper strategy.',
        extraEvidence: [
          totalValue > 0
            ? `Visible portfolio value: ${formatUsd(totalValue)}`
            : 'Visible funded value is limited in the current scope.',
          `Largest visible holding: ${topHolding ? topHolding.symbol : 'Not yet clear'}`,
          `Dominant visible network: ${latestScan?.dominantChain || snapshot?.summary?.networkLabel || 'Not yet clear'}`
        ],
        sources: [{ label: 'Wallet Scan', url: 'https://www.alchemy.com/' }]
      }),
      reasoning: 'A weak evidence base leads to weak recommendations. It is better to state that the scan is partial than to act certain from incomplete visibility.',
      sources: [{ label: 'Wallet Scan', url: 'https://www.alchemy.com/' }],
      actions: []
    };
  }

  return null;
}

async function handleChat(req, res) {
  try {
    const { walletAddress, message } = await readRequestBody(req);
    if (!message || typeof message !== 'string') {
      return sendJson(res, 400, { error: 'Message is required' });
    }
    if (walletAddress && !Wallet.isValidAddress(walletAddress)) {
      return sendJson(res, 400, { error: 'Valid walletAddress is required' });
    }
    if (walletAddress && walletAddress.toLowerCase() === ZERO_ADDRESS) {
      return sendJson(res, 400, { error: 'Zero address is not a valid wallet for chat analysis' });
    }

    const classification = classifyLyraPrompt(message);
    const fastPrompt = /^(hi|hey|hello|yo|gm|good morning|good afternoon|good evening|how are you|how are you doing|how's it going|hows it going|what's up|whats up|thanks|thank you|nice|cool|great|what can you do|what do you do|who are you|tell me about lyra|introduce yourself|help|how does this work|how does lyra work|what is lyra|give me an overview|give me a quick intro)[\s!.?]*$/i.test(message.trim())
      || /bridge|swap|send|yield|apy|opportunit|compare|merchant|agni|lendle|idle|deploy/i.test(message);
    if (!walletAddress) {
      if (isWalletDependentIntent(classification)) {
        const response = classification.mode === 'action'
          ? 'Connect a wallet first. LYRA needs wallet context before it can prepare that action.'
          : 'Connect a wallet first so LYRA can analyze real wallet behavior instead of guessing.';
        return sendJson(res, 200, {
          ok: true,
          response,
          mode: classification.mode
        });
      }

      const directResponse = await buildDirectLyraResponse(message, null, null);
      if (directResponse) {
        return sendJson(res, 200, {
          ok: true,
          response: directResponse.text || '',
          html: directResponse.html || null,
          mode: classification.mode
        });
      }

      return sendJson(res, 200, {
        ok: true,
        response: 'Ask about Mantle opportunities, protocol comparisons, or connect a wallet for wallet-specific analysis and execution.',
        mode: classification.mode
      });
    }

    const cachedScan = getLatestWalletScan(walletAddress);
    if (fastPrompt) {
      const fastResponse = await buildDirectLyraResponse(message, null, cachedScan);
      if (fastResponse) {
        const payload = typeof fastResponse === 'string'
          ? { response: fastResponse, html: null }
          : { response: fastResponse.text || '', html: fastResponse.html || null };
        return sendJson(res, 200, {
          ok: true,
          ...payload,
          mode: classification.mode
        });
      }
    }

    const snapshot = await withTimeout(buildPortfolioSnapshot(walletAddress), 12000, 'Portfolio snapshot')
      .catch(() => null);
    const mappedSnapshot = snapshot ? mapPortfolioForClient(snapshot) : null;
    const latestScan = await withTimeout(runWalletScan(walletAddress), 12000, 'Wallet scan')
      .catch(() => cachedScan);
    const directResponse = await buildDirectLyraResponse(message, mappedSnapshot, latestScan);
    if (directResponse) {
      const payload = typeof directResponse === 'string'
        ? { response: directResponse, html: null }
        : { response: directResponse.text || '', html: directResponse.html || null };
      const decision = createDecisionRecord(
        walletAddress,
        message,
        directResponse,
        latestScan,
        {
          reasoning: directResponse.reasoning,
          sources: directResponse.sources,
          actions: directResponse.actions,
          lifiIntent: directResponse.metadata?.lifiIntent || null
        }
      );
      if (decision) {
        saveAgentDecision(walletAddress, decision);
      }
      return sendJson(res, 200, {
        ok: true,
        ...payload,
        snapshot: mappedSnapshot,
        mode: classification.mode
      });
    }

    if (!aiBrain) {
      return sendJson(res, 200, {
        ok: true,
        response: 'I can answer live Mantle opportunity and wallet-context questions right now. For broader conversational intelligence, the AI service is not configured on the server.',
        snapshot: mappedSnapshot,
        mode: classification.mode
      });
    }

    if (!snapshot) {
      return sendJson(res, 200, {
        ok: true,
        response: 'Wallet context is loading slowly right now. Try the prompt again in a moment, or ask for bridge, swap, send, yields, or Mantle opportunities.',
        mode: classification.mode
      });
    }

    const response = await aiBrain.chat(message, snapshot);
    return sendJson(res, 200, {
      ok: true,
      response,
      snapshot: mapPortfolioForClient(snapshot),
      mode: classification.mode
    });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

async function handleActionQuote(req, res) {
  try {
    const { walletAddress, actionType, amount, tokenSymbol, toTokenSymbol, fromNetwork, toNetwork, recipient } = await readRequestBody(req);
    if (!walletAddress || !Wallet.isValidAddress(walletAddress)) {
      return sendJson(res, 400, { error: 'Valid walletAddress is required' });
    }
    if (!actionType || !['bridge', 'swap', 'send'].includes(String(actionType).toLowerCase())) {
      return sendJson(res, 400, { error: 'Valid actionType is required' });
    }

    const validation = validateExecutionRequest(actionType, {
      fromNetwork,
      toNetwork,
      tokenSymbol,
      toTokenSymbol,
      recipient
    });
    if (!validation.ok) {
      return sendJson(res, 400, { error: validation.error });
    }

    if (String(actionType).toLowerCase() === 'send') {
      const sendToken = await resolveLifiToken(validation.fromChain, validation.tokenSymbol);
      return sendJson(res, 200, {
        ok: true,
        actionType: 'send',
        intent: {
          status: 'ready',
          executionKind: validation.support.executionKind,
          fromNetwork: validation.fromChain.label,
          toNetwork: toNetwork || null,
          fromToken: validation.tokenSymbol,
          toToken: validation.toTokenSymbol || null,
          fromAmount: amount || '',
          fromTokenAddress: sendToken.address,
          fromTokenDecimals: sendToken.decimals,
          recipient: recipient || '',
          summary: recipient
            ? `Transfer prepared for ${amount || '--'} ${validation.tokenSymbol} to ${recipient}.`
            : 'Transfer parameters captured. Recipient still required before LYRA can submit.'
        }
      });
    }

    const normalizedActionType = String(actionType).toLowerCase();
    const intent = normalizedActionType === 'bridge' && isMantleCanonicalBridgePair(validation.fromChain, validation.toChain)
      ? buildMantleCanonicalBridgeIntent({
          amount,
          fromTokenSymbol: validation.tokenSymbol,
          fromChain: validation.fromChain,
          toChain: validation.toChain,
          fromAddress: walletAddress
        })
      : normalizedActionType === 'swap'
        ? await merchantMoeService.buildSwapIntent({
            amount,
            fromTokenSymbol: validation.tokenSymbol,
            toTokenSymbol: validation.toTokenSymbol || validation.tokenSymbol,
            fromAddress: walletAddress
          })
        : await buildLifiActionIntent(normalizedActionType, {
            amount,
            fromTokenSymbol: validation.tokenSymbol,
            toTokenSymbol: validation.toTokenSymbol || validation.tokenSymbol,
            fromChain: validation.fromChain,
            toChain: validation.toChain || validation.fromChain,
            fromAddress: walletAddress
          });

    return sendJson(res, 200, {
      ok: true,
      actionType,
      intent: {
        ...intent,
        executionKind: validation.support.executionKind,
        fromNetwork: validation.fromChain.label,
        toNetwork: validation.toChain?.label || null,
        requestedSymbol: validation.tokenSymbol || null
      }
    });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

async function handleActionPanel(req, res) {
  try {
    const { actionType, values = {} } = await readRequestBody(req);
    const support = getExecutionSupport(actionType);
    if (!support) {
      return sendJson(res, 400, { error: 'Unsupported action type.' });
    }

    return sendJson(res, 200, {
      ok: true,
      actionType: support.actionType,
      support,
      html: renderExecutionPanel({
        actionType: support.actionType,
        amount: values.amount || '',
        tokenSymbol: values.tokenSymbol || '',
        toTokenSymbol: values.toTokenSymbol || '',
        fromNetwork: values.fromNetwork || '',
        toNetwork: values.toNetwork || '',
        recipient: values.recipient || '',
        note: values.note || support.note
      })
    });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

async function handleAgentDecisions(req, res, walletAddress) {
  try {
    if (!walletAddress || !Wallet.isValidAddress(walletAddress)) {
      return sendJson(res, 400, { error: 'Valid wallet address is required' });
    }
    return sendJson(res, 200, {
      ok: true,
      decisions: getRecentAgentDecisions(walletAddress, 50)
    });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

async function handleScanWallet(req, res) {
  try {
    const { walletAddress } = await readRequestBody(req);
    if (!walletAddress || !Wallet.isValidAddress(walletAddress)) {
      return sendJson(res, 400, { error: 'Valid walletAddress is required' });
    }
    if (walletAddress.toLowerCase() === ZERO_ADDRESS) {
      return sendJson(res, 400, { error: 'Zero address is not a valid wallet for analysis' });
    }

    const cachedScan = getLatestWalletScan(walletAddress);
    if (cachedScan) {
      const ageMs = Date.now() - new Date(cachedScan.createdAt).getTime();
      const cachedCoverage = String(cachedScan.historyCoverage || '').toLowerCase();
      const cachedConfidence = String(cachedScan.walletConfidence?.level || '').toLowerCase();
      const shouldReuseCachedScan = Number.isFinite(ageMs)
        && ageMs >= 0
        && ageMs < 5 * 60 * 1000
        && cachedCoverage !== 'limited'
        && cachedConfidence !== 'low';
      if (shouldReuseCachedScan) {
        return sendJson(res, 200, {
          walletAddress,
          scannedAt: cachedScan.createdAt,
          reused: true,
          ...cachedScan
        });
      }
    }

    const analysis = await runWalletScan(walletAddress);
    return sendJson(res, 200, analysis);
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

async function handleWalletAnalysis(req, res, walletAddress) {
  try {
    if (!walletAddress || !Wallet.isValidAddress(walletAddress)) {
      return sendJson(res, 400, { error: 'Valid wallet address is required' });
    }

    const latest = getLatestWalletScan(walletAddress);
    const analysis = await runWalletScan(walletAddress);
    return sendJson(res, 200, {
      ...analysis,
      previousScan: latest
    });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

function serveStatic(req, res) {
  const parsedUrl = new URL(req.url, 'http://127.0.0.1');
  const requestPath = parsedUrl.pathname === '/' ? '/lyra.html' : parsedUrl.pathname;
  const safePath = path.normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(__dirname, safePath);

  if (!filePath.startsWith(__dirname)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'File not found' });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const shouldDisableCache = ['.html', '.js', '.css', '.json'].includes(ext);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      ...(shouldDisableCache ? { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } : {})
    });
    res.end(data);
  });
}

export async function handleLyraRequest(req, res, { serveStaticAssets = true } = {}) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/portfolio') {
    await handlePortfolio(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/history') {
    await handleHistory(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/chat') {
    await handleChat(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/action/quote') {
    await handleActionQuote(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/action/panel') {
    await handleActionPanel(req, res);
    return;
  }

  if (req.method === 'POST' && (req.url === '/scan-wallet' || req.url === '/api/scan-wallet')) {
    await handleScanWallet(req, res);
    return;
  }

  if (req.method === 'GET' && (req.url.startsWith('/wallet-analysis/') || req.url.startsWith('/api/wallet-analysis/'))) {
    const address = req.url.startsWith('/api/wallet-analysis/')
      ? parseAddressFromPath(req.url, '/api/wallet-analysis/')
      : parseAddressFromPath(req.url, '/wallet-analysis/');
    await handleWalletAnalysis(req, res, address);
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/agent-decisions/')) {
    const address = parseAddressFromPath(req.url, '/api/agent-decisions/');
    await handleAgentDecisions(req, res, address);
    return;
  }

  if (req.method === 'GET' && req.url === '/api/market-tape') {
    await handleMarketTape(req, res);
    return;
  }

  if (req.method === 'GET' && req.url === '/api/opportunities') {
    await handleLiveOpportunities(req, res);
    return;
  }

  if (serveStaticAssets) {
    serveStatic(req, res);
  } else {
    sendJson(res, 404, { error: 'Not found' });
  }
}

export default async function vercelHandler(req, res) {
  return handleLyraRequest(req, res, { serveStaticAssets: true });
}

const server = http.createServer((req, res) => {
  handleLyraRequest(req, res, { serveStaticAssets: true }).catch((error) => {
    console.error('LYRA request handler failed:', error);
    if (!res.headersSent) {
      sendJson(res, 500, { error: error.message || 'Internal server error' });
    }
  });
});

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectExecution) {
  server.listen(PORT, HOST, () => {
    console.log(`LYRA server running at http://${HOST}:${PORT}`);
  });
}
