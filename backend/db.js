import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const storageDir = path.join(__dirname, 'storage');

if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

const dbPath = path.join(storageDir, 'lyra.sqlite');
const db = new DatabaseSync(dbPath);

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

const insertScanStmt = db.prepare(`
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

const getLatestScanStmt = db.prepare(`
  SELECT *
  FROM wallet_scans
  WHERE lower(wallet) = lower(?)
  ORDER BY datetime(created_at) DESC, id DESC
  LIMIT 1
`);

const insertDecisionStmt = db.prepare(`
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

const getRecentDecisionsStmt = db.prepare(`
  SELECT *
  FROM agent_decisions
  WHERE lower(wallet) = lower(?)
  ORDER BY datetime(created_at) DESC, id DESC
  LIMIT ?
`);

export function saveWalletScan(wallet, analysis) {
  const createdAt = new Date().toISOString();
  insertScanStmt.run(
    wallet,
    analysis?.dominantChain || null,
    JSON.stringify(analysis?.topHoldings || []),
    Number(analysis?.transactionCount || 0),
    JSON.stringify(analysis?.activeChains || []),
    analysis?.walletConfidence?.level || 'LOW',
    createdAt
  );

  return createdAt;
}

export function getLatestWalletScan(wallet) {
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

export function saveAgentDecision(wallet, decision = {}) {
  const createdAt = new Date().toISOString();
  insertDecisionStmt.run(
    wallet,
    decision.prompt || '',
    decision.insight || null,
    decision.reasoning || null,
    decision.confidenceLabel || null,
    decision.confidenceDetail || null,
    JSON.stringify(decision.sources || []),
    JSON.stringify(decision.actions || []),
    JSON.stringify(decision.metadata || {}),
    createdAt
  );

  return createdAt;
}

export function getRecentAgentDecisions(wallet, limit = 20) {
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

export default db;
