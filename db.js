// db.js — Async sql.js init, table creation, getDb() export

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

let db = null;
let saving = false;

const TABLES = {
  repos: `
    CREATE TABLE IF NOT EXISTS repos (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      full_name TEXT,
      description TEXT,
      is_private BOOLEAN DEFAULT 0,
      language TEXT,
      enabled BOOLEAN DEFAULT 0,
      updated_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `,
  tasks: `
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY,
      repo_id INTEGER NOT NULL,
      task_type TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      scheduled_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      result TEXT,
      error TEXT,
      config TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (repo_id) REFERENCES repos(id)
    )
  `,
  feature_ideas: `
    CREATE TABLE IF NOT EXISTS feature_ideas (
      id INTEGER PRIMARY KEY,
      repo_id INTEGER NOT NULL,
      task_id INTEGER,
      title TEXT,
      description TEXT,
      why TEXT,
      difficulty TEXT,
      code_preview TEXT,
      mock_ui_html TEXT,
      status TEXT DEFAULT 'proposed',
      github_issue_url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (repo_id) REFERENCES repos(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `,
  settings: `
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `,
  repo_task_config: `
    CREATE TABLE IF NOT EXISTS repo_task_config (
      repo_id INTEGER NOT NULL,
      task_type TEXT NOT NULL,
      enabled BOOLEAN DEFAULT 1,
      schedule TEXT DEFAULT 'nightly',
      model TEXT,
      PRIMARY KEY (repo_id, task_type),
      FOREIGN KEY (repo_id) REFERENCES repos(id)
    )
  `,
};

async function init() {
  if (db) return db;

  const SQL = await initSqlJs();

  // Ensure directory exists
  const dir = path.dirname(config.DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Load existing DB or create new one
  if (fs.existsSync(config.DB_PATH)) {
    const buf = fs.readFileSync(config.DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  // Enable WAL-like behavior — auto-save on changes
  db.run('PRAGMA journal_mode=WAL');

  // Create all tables
  for (const [name, sql] of Object.entries(TABLES)) {
    db.run(sql);
  }

  await save();
  console.log(`[db] Initialized at ${config.DB_PATH}`);
  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call init() first.');
  return db;
}

async function save() {
  if (!db || saving) return;
  saving = true;
  try {
    const data = db.export();
    const buf = Buffer.from(data);
    const dir = path.dirname(config.DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(config.DB_PATH, buf);
  } catch (err) {
    console.error('[db] Save error:', err.message);
  } finally {
    saving = false;
  }
}

// Helper: run a query and auto-save
function run(sql, params = []) {
  const d = getDb();
  d.run(sql, params);
  // Fire-and-forget save
  save().catch(() => {});
  return { changes: d.getRowsModified() };
}

// Helper: get all rows
function all(sql, params = []) {
  const d = getDb();
  const stmt = d.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Helper: get one row
function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

module.exports = { init, getDb, save, run, all, get };
