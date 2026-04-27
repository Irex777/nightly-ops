// github.js — GitHub integration via `gh` CLI

const { execSync } = require('child_process');
const config = require('./config');
const db = require('./db');

/**
 * Run a gh CLI command and return parsed JSON.
 */
function ghCommand(args) {
  // Read GitHub token from DB settings
  const row = db.get('SELECT value FROM settings WHERE key = ?', ['github_token']);
  const token = row ? row.value : null;

  if (!token) {
    throw new Error('GitHub token not configured. Add it in Settings.');
  }

  try {
    const result = execSync(`gh ${args}`, {
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, GH_TOKEN: token },
    });
    return JSON.parse(result.trim());
  } catch (err) {
    throw new Error(`gh CLI error: ${err.message}`);
  }
}

/**
 * Sync repos from GitHub into the database.
 * Uses `gh repo list` — adds new repos, updates existing, never deletes.
 */
async function syncRepos() {
  const limit = config.SYNC_LIMIT;
  const repos = ghCommand(
    `repo list Irex777 --limit ${limit} --json name,description,isPrivate,updatedAt,primaryLanguage`
  );

  const results = [];

  for (const repo of repos) {
    const fullName = `Irex777/${repo.name}`;
    const language = repo.primaryLanguage ? repo.primaryLanguage.name : null;
    const updatedAt = repo.updatedAt || null;
    const isPrivate = repo.isPrivate ? 1 : 0;
    const description = repo.description || '';

    // Upsert: insert or update existing
    const existing = db.get('SELECT id FROM repos WHERE name = ?', [repo.name]);

    if (existing) {
      db.run(
        `UPDATE repos SET
          full_name = ?, description = ?, is_private = ?, language = ?, updated_at = ?
         WHERE id = ?`,
        [fullName, description, isPrivate, language, updatedAt, existing.id]
      );
      results.push({ id: existing.id, name: repo.name, action: 'updated' });
    } else {
      db.run(
        `INSERT INTO repos (name, full_name, description, is_private, language, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
        [repo.name, fullName, description, isPrivate, language, updatedAt]
      );
      const row = db.get('SELECT id FROM repos WHERE name = ?', [repo.name]);
      results.push({ id: row.id, name: repo.name, action: 'inserted' });
    }
  }

  return results;
}

/**
 * Get all repos from the database.
 */
function getRepos() {
  return db.all('SELECT * FROM repos ORDER BY updated_at DESC');
}

/**
 * Get a single repo by ID.
 */
function getRepo(id) {
  return db.get('SELECT * FROM repos WHERE id = ?', [id]);
}

/**
 * Update a repo (mainly the enabled toggle).
 */
function updateRepo(id, updates) {
  const allowed = ['enabled', 'description', 'language'];
  const fields = [];
  const values = [];

  for (const key of allowed) {
    if (updates[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(updates[key]);
    }
  }

  if (fields.length === 0) return null;

  values.push(id);
  db.run(`UPDATE repos SET ${fields.join(', ')} WHERE id = ?`, values);
  return getRepo(id);
}

/**
 * Set task configuration for a repo.
 * Body: { task_types: ['code_review', 'test_gen', ...] }
 */
function setRepoTasks(repoId, taskTypes) {
  const TASK_TYPES = [
    'code_review', 'test_gen', 'dep_check', 'lint_fix',
    'feature_ideas', 'perf_audit', 'docs_gen'
  ];

  // Disable all existing
  db.run('UPDATE repo_task_config SET enabled = 0 WHERE repo_id = ?', [repoId]);

  // Enable selected
  for (const tt of taskTypes) {
    if (!TASK_TYPES.includes(tt)) continue;
    db.run(
      `INSERT INTO repo_task_config (repo_id, task_type, enabled) VALUES (?, ?, 1)
       ON CONFLICT(repo_id, task_type) DO UPDATE SET enabled = 1`,
      [repoId, tt]
    );
  }

  return getRepoTasks(repoId);
}

/**
 * Get task configuration for a repo.
 */
function getRepoTasks(repoId) {
  return db.all(
    'SELECT * FROM repo_task_config WHERE repo_id = ? ORDER BY task_type',
    [repoId]
  );
}

module.exports = { syncRepos, getRepos, getRepo, updateRepo, setRepoTasks, getRepoTasks };
