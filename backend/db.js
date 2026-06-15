import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db = null;
let insertScanStmt = null;
let getLatestScanStmt = null;
let insertDecisionStmt = null;
let getRecentDecisionsStmt = null;

const memoryStore = {
  walletScans: [],
  agentDecisions: []
};

function initializeSqlite() {
  const storageDir = process.env.VERCEL
    ? path.join('/tmp', 'lyra-storage')
    : path.join(__dirname, 'storage');

  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }

  const dbPath = path.join(storageDir, 'lyra.sqlite');
  db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      dominant_chain TEXT,
      top_holdings TEXT,
      transaction_count INTEGER DEFAULT 0,
      active_chains TEXT,
      confidence TEXT,
      created_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      prompt TEXT NOT NULL,
      insight TEXT,
      reasoning TEXT,
      confidence_label TEXT,
      confidence_detail TEXT,
      sources_json TEXT,
      actions_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    )
  `);

  insertScanStmt = db.prepare(`
    INSERT INTO wallet_scans (
      wallet,
      dominant_chain,
      top_holdings,
      transaction_count,
      active_chains,
      confidence,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  getLatestScanStmt = db.prepare(`
    SELECT *
    FROM wallet_scans
    WHERE lower(wallet) = lower(?)
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 1
  `);

  insertDecisionStmt = db.prepare(`
    INSERT INTO agent_decisions (
      wallet,
      prompt,
      insight,
      reasoning,
      confidence_label,
      confidence_detail,
      sources_json,
      actions_json,
      metadata_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  getRecentDecisionsStmt = db.prepare(`
    SELECT *
    FROM agent_decisions
    WHERE lower(wallet) = lower(?)
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `);
}

try {
  initializeSqlite();
} catch (error) {
  console.warn('LYRA database fallback enabled:', error?.message || error);
}

function readLatestMemoryScan(wallet) {
  return memoryStore.walletScans
    .filter((entry) => entry.wallet.toLowerCase() === wallet.toLowerCase())
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
}

function readRecentMemoryDecisions(wallet, limit = 20) {
  return memoryStore.agentDecisions
    .filter((entry) => entry.wallet.toLowerCase() === wallet.toLowerCase())
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, Number(limit || 20));
}

export function saveWalletScan(wallet, analysis) {
  const createdAt = new Date().toISOString();
  const payload = {
    id: memoryStore.walletScans.length + 1,
    wallet,
    dominantChain: analysis?.dominantChain || null,
    topHoldings: analysis?.topHoldings || [],
    transactionCount: Number(analysis?.transactionCount || 0),
    activeChains: analysis?.activeChains || [],
    confidence: analysis?.walletConfidence?.level || 'LOW',
    createdAt
  };

  if (insertScanStmt) {
    insertScanStmt.run(
      wallet,
      payload.dominantChain,
      JSON.stringify(payload.topHoldings),
      payload.transactionCount,
      JSON.stringify(payload.activeChains),
      payload.confidence,
      createdAt
    );
    return createdAt;
  }

  memoryStore.walletScans.push(payload);
  return createdAt;
}

export function getLatestWalletScan(wallet) {
  if (getLatestScanStmt) {
    const row = getLatestScanStmt.get(wallet);
    if (!row) return null;

    return {
      id: row.id,
      wallet: row.wallet,
      dominantChain: row.dominant_chain,
      topHoldings: JSON.parse(row.top_holdings || '[]'),
      transactionCount: Number(row.transaction_count || 0),
      activeChains: JSON.parse(row.active_chains || '[]'),
      confidence: row.confidence,
      createdAt: row.created_at
    };
  }

  return readLatestMemoryScan(wallet);
}

export function saveAgentDecision(wallet, decision = {}) {
  const createdAt = new Date().toISOString();
  const payload = {
    id: memoryStore.agentDecisions.length + 1,
    wallet,
    prompt: decision.prompt || '',
    insight: decision.insight || null,
    reasoning: decision.reasoning || null,
    confidenceLabel: decision.confidenceLabel || null,
    confidenceDetail: decision.confidenceDetail || null,
    sources: decision.sources || [],
    actions: decision.actions || [],
    metadata: decision.metadata || {},
    createdAt
  };

  if (insertDecisionStmt) {
    insertDecisionStmt.run(
      wallet,
      payload.prompt,
      payload.insight,
      payload.reasoning,
      payload.confidenceLabel,
      payload.confidenceDetail,
      JSON.stringify(payload.sources),
      JSON.stringify(payload.actions),
      JSON.stringify(payload.metadata),
      createdAt
    );
    return createdAt;
  }

  memoryStore.agentDecisions.push(payload);
  return createdAt;
}

export function getRecentAgentDecisions(wallet, limit = 20) {
  if (getRecentDecisionsStmt) {
    const rows = getRecentDecisionsStmt.all(wallet, Number(limit || 20));
    return rows.map((row) => ({
      id: row.id,
      wallet: row.wallet,
      prompt: row.prompt,
      insight: row.insight,
      reasoning: row.reasoning,
      confidenceLabel: row.confidence_label,
      confidenceDetail: row.confidence_detail,
      sources: JSON.parse(row.sources_json || '[]'),
      actions: JSON.parse(row.actions_json || '[]'),
      metadata: JSON.parse(row.metadata_json || '{}'),
      createdAt: row.created_at
    }));
  }

  return readRecentMemoryDecisions(wallet, limit);
}

export default db;
