// server.js — Express app: static serving, API routes, health check, SSE, runner

const express = require('express');
const path = require('path');
const { execSync } = require('child_process');
const config = require('./config');
const db = require('./db');
const github = require('./github');
const { EventManager } = require('./sse');
const { TaskRunner } = require('./runner');
const ai = require('./ai');

const app = express();

// ─── Middleware ──────────────────────────────────────────────────────────────

app.use(express.json());

// X-Accel-Buffering: no — helps SSE through Cloudflare/nginx
app.use((_req, res, next) => {
  res.setHeader('X-Accel-Buffering', 'no');
  next();
});

// No-cache headers for index.html and app.js (iPad cache busting)
app.get(['/index.html', '/app.js', '/style.css'], (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Instances (initialized in start()) ──────────────────────────────────────

let eventManager = null;
let runner = null;

// ─── Health Check ───────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  try {
    const d = db.getDb();
    // Quick DB check
    d.prepare('SELECT 1').step();
    return res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(503).json({ status: 'error', error: err.message });
  }
});

// ─── Repo Routes ────────────────────────────────────────────────────────────

// Sync repos from GitHub
app.post('/api/repos/sync', async (_req, res) => {
  try {
    const results = await github.syncRepos();
    const repos = github.getRepos();
    return res.json({ sync: results, repos });
  } catch (err) {
    console.error('[sync] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// List all repos
app.get('/api/repos', (_req, res) => {
  try {
    const repos = github.getRepos();
    return res.json(repos);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Update repo (mainly enabled toggle)
app.patch('/api/repos/:id', (req, res) => {
  try {
    const repo = github.updateRepo(parseInt(req.params.id, 10), req.body);
    if (!repo) return res.status(404).json({ error: 'Repo not found' });
    return res.json(repo);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Set enabled task types for a repo
app.put('/api/repos/:id/tasks', (req, res) => {
  try {
    const repoId = parseInt(req.params.id, 10);
    const repo = github.getRepo(repoId);
    if (!repo) return res.status(404).json({ error: 'Repo not found' });
    const taskConfig = github.setRepoTasks(repoId, req.body.task_types || []);
    return res.json(taskConfig);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Get task config for a repo
app.get('/api/repos/:id/tasks', (req, res) => {
  try {
    const repoId = parseInt(req.params.id, 10);
    const repo = github.getRepo(repoId);
    if (!repo) return res.status(404).json({ error: 'Repo not found' });
    const taskConfig = github.getRepoTasks(repoId);
    return res.json(taskConfig);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Feature Ideas Routes ───────────────────────────────────────────────────

// Generate feature ideas for a repo
app.post('/api/repos/:id/feature-ideas', async (req, res) => {
  try {
    const repoId = parseInt(req.params.id, 10);
    const repo = github.getRepo(repoId);
    if (!repo) return res.status(404).json({ error: 'Repo not found' });

    const fullName = repo.full_name || `Irex777/${repo.name}`;

    // Fetch repo info via gh CLI
    let repoStructure = '';
    let recentCommits = '';
    let readme = '';

    try {
      repoStructure = execSync(
        `gh api repos/${fullName}/git/trees/HEAD?recursive=1 --jq '.tree[].path'`,
        { encoding: 'utf-8', timeout: 15000 }
      ).slice(0, 4000);
    } catch (_e) { /* structure unavailable */ }

    try {
      recentCommits = execSync(
        `gh api repos/${fullName}/commits?per_page=10 --jq '.[].commit.message'`,
        { encoding: 'utf-8', timeout: 15000 }
      ).slice(0, 2000);
    } catch (_e) { /* commits unavailable */ }

    try {
      readme = execSync(
        `gh api repos/${fullName}/readme --jq '.content' | base64 -d`,
        { encoding: 'utf-8', timeout: 15000 }
      ).slice(0, 4000);
    } catch (_e) { /* readme unavailable */ }

    // Call ZAI AI
    const ideas = await ai.generateFeatureIdeas(repo.name, repoStructure, recentCommits, readme);

    // Store each idea in the database
    const storedIdeas = [];
    for (const idea of ideas) {
      db.run(
        `INSERT INTO feature_ideas (repo_id, title, description, why, difficulty, code_preview, mock_ui_html, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed')`,
        [repoId, idea.title, idea.description, idea.why, idea.difficulty, idea.code_preview, idea.mock_ui_html]
      );
      const row = db.get('SELECT last_insert_rowid() as id');
      storedIdeas.push({ id: row.id, ...idea, status: 'proposed', repo_id: repoId });
    }

    // Emit event
    if (eventManager) {
      eventManager.broadcast('ideas_generated', { repoId, repoName: repo.name, count: storedIdeas.length });
    }

    return res.json(storedIdeas);
  } catch (err) {
    console.error('[feature-ideas] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// List feature ideas for a repo
app.get('/api/repos/:id/feature-ideas', (req, res) => {
  try {
    const repoId = parseInt(req.params.id, 10);
    const ideas = db.all(
      'SELECT fi.*, r.name as repo_name FROM feature_ideas fi JOIN repos r ON fi.repo_id = r.id WHERE fi.repo_id = ? ORDER BY fi.created_at DESC',
      [repoId]
    );
    return res.json(ideas);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Update feature idea status
app.patch('/api/feature-ideas/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;
    if (!['proposed', 'approved', 'rejected', 'implemented'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    db.run('UPDATE feature_ideas SET status = ? WHERE id = ?', [status, id]);
    const idea = db.get('SELECT fi.*, r.name as repo_name FROM feature_ideas fi JOIN repos r ON fi.repo_id = r.id WHERE fi.id = ?', [id]);
    if (!idea) return res.status(404).json({ error: 'Idea not found' });
    return res.json(idea);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Create GitHub issue from a feature idea
app.post('/api/feature-ideas/:id/create-issue', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const idea = db.get('SELECT fi.*, r.name as repo_name, r.full_name as repo_full_name FROM feature_ideas fi JOIN repos r ON fi.repo_id = r.id WHERE fi.id = ?', [id]);
    if (!idea) return res.status(404).json({ error: 'Idea not found' });

    const fullName = idea.repo_full_name || `Irex777/${idea.repo_name}`;
    const title = `💡 Feature: ${idea.title}`;
    const body = `## ${idea.title}\n\n${idea.description}\n\n### Why\n${idea.why || 'N/A'}\n\n### Difficulty: ${idea.difficulty}\n\n${idea.code_preview ? `### Code Preview\n\`\`\`\n${idea.code_preview}\n\`\`\`` : ''}`;

    const result = execSync(
      `gh issue create --repo ${fullName} --title ${shellQuote(title)} --body ${shellQuote(body)}`,
      { encoding: 'utf-8', timeout: 30000 }
    ).trim();

    // Update the idea with the issue URL
    db.run('UPDATE feature_ideas SET github_issue_url = ?, status = ? WHERE id = ?', [result, 'approved', id]);

    if (eventManager) {
      eventManager.broadcast('issue_created', { ideaId: id, url: result, repoName: idea.repo_name });
    }

    return res.json({ url: result, status: 'approved' });
  } catch (err) {
    console.error('[feature-ideas:create-issue] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── Task / Runner Routes ───────────────────────────────────────────────────

// SSE endpoint for live task streaming
app.get('/api/tasks/events', (req, res) => {
  if (!eventManager) return res.status(503).json({ error: 'EventManager not initialized' });
  eventManager.addClient(req, res);
});

// Trigger nightly run manually
app.post('/api/tasks/nightly/trigger', async (_req, res) => {
  try {
    if (!runner) return res.status(503).json({ error: 'Runner not initialized' });
    const result = await runner.runNightly();
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// List all tasks with optional filtering
app.get('/api/tasks', (req, res) => {
  try {
    const { status, repo_id, task_type, limit } = req.query;
    let sql = `SELECT t.*, r.name as repo_name, r.full_name as repo_full_name
               FROM tasks t JOIN repos r ON t.repo_id = r.id WHERE 1=1`;
    const params = [];
    if (status) { sql += ' AND t.status = ?'; params.push(status); }
    if (repo_id) { sql += ' AND t.repo_id = ?'; params.push(parseInt(repo_id, 10)); }
    if (task_type) { sql += ' AND t.task_type = ?'; params.push(task_type); }
    sql += ' ORDER BY t.created_at DESC';
    if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit, 10)); }
    const tasks = db.all(sql, params);
    return res.json(tasks);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Get single task with full result
app.get('/api/tasks/:id', (req, res) => {
  try {
    const task = db.get(
      `SELECT t.*, r.name as repo_name, r.full_name as repo_full_name
       FROM tasks t JOIN repos r ON t.repo_id = r.id WHERE t.id = ?`,
      [parseInt(req.params.id, 10)]
    );
    if (!task) return res.status(404).json({ error: 'Task not found' });
    return res.json(task);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Cancel a running task
app.post('/api/tasks/cancel/:id', (req, res) => {
  try {
    if (!runner) return res.status(503).json({ error: 'Runner not initialized' });
    const taskId = parseInt(req.params.id, 10);
    const cancelled = runner.cancelTask(taskId);
    if (!cancelled) return res.status(400).json({ error: 'Task not running or queued' });
    return res.json({ message: `Task ${taskId} cancelled` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Get current runner queue status
app.get('/api/queue', (_req, res) => {
  try {
    if (!runner) return res.status(503).json({ error: 'Runner not initialized' });
    return res.json(runner.getQueue());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Settings Routes ────────────────────────────────────────────────────────

// Get all settings
app.get('/api/settings', (_req, res) => {
  try {
    const rows = db.all('SELECT key, value FROM settings');
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return res.json(settings);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Update settings
app.patch('/api/settings', (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      db.run(
        `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`,
        [key, String(value), String(value)]
      );
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Test ZAI Connection
app.post('/api/settings/test-zai', async (_req, res) => {
  try {
    const result = await ai.testConnection();
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// Test Claude Code
app.post('/api/settings/test-claude', (_req, res) => {
  try {
    const result = execSync('claude --version', { encoding: 'utf-8', timeout: 10000 }).trim();
    return res.json({ ok: true, message: `Claude Code found: ${result}` });
  } catch (err) {
    return res.json({ ok: false, message: 'Claude Code not found or not working' });
  }
});

// ─── SPA Fallback ───────────────────────────────────────────────────────────

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function shellQuote(str) {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

// ─── Start ──────────────────────────────────────────────────────────────────

async function start() {
  await db.init();
  console.log('[db] Ready');

  // Initialize EventManager and TaskRunner
  eventManager = new EventManager();
  runner = new TaskRunner(db, eventManager);
  console.log('[runner] TaskRunner initialized');

  // Recover any crashed tasks from previous run
  await runner.recoverCrashedTasks();

  app.listen(config.PORT, () => {
    console.log(`[server] Nightly Ops running on port ${config.PORT}`);
    console.log(`[server] Environment: ${config.NODE_ENV}`);
  });
}

// Graceful shutdown
function shutdown(signal) {
  console.log(`[server] Received ${signal}, shutting down...`);
  if (eventManager) eventManager.shutdown();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((err) => {
  console.error('[server] Fatal start error:', err);
  process.exit(1);
});
