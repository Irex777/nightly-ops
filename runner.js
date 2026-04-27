// runner.js — Autonomous task runner engine for Nightly Ops
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INTEGRATION — Add these lines to server.js (after existing requires):
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
//   const { EventManager } = require('./sse');
//   const { TaskRunner } = require('./runner');
//
//   const eventManager = new EventManager();
//   const runner = new TaskRunner(db, eventManager);
//
//   // SSE endpoint for live task streaming
//   app.get('/api/tasks/events', (req, res) => eventManager.addClient(req, res));
//
//   // Trigger nightly run manually
//   app.post('/api/tasks/nightly/trigger', async (_req, res) => {
//     try {
//       const result = await runner.runNightly();
//       return res.json(result);
//     } catch (err) {
//       return res.status(500).json({ error: err.message });
//     }
//   });
//
//   // List all tasks with optional filtering
//   app.get('/api/tasks', (req, res) => {
//     try {
//       const { status, repo_id, task_type, limit } = req.query;
//       let sql = `SELECT t.*, r.name as repo_name, r.full_name as repo_full_name
//                  FROM tasks t JOIN repos r ON t.repo_id = r.id WHERE 1=1`;
//       const params = [];
//       if (status) { sql += ' AND t.status = ?'; params.push(status); }
//       if (repo_id) { sql += ' AND t.repo_id = ?'; params.push(parseInt(repo_id, 10)); }
//       if (task_type) { sql += ' AND t.task_type = ?'; params.push(task_type); }
//       sql += ' ORDER BY t.created_at DESC';
//       if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit, 10)); }
//       const tasks = db.all(sql, params);
//       return res.json(tasks);
//     } catch (err) {
//       return res.status(500).json({ error: err.message });
//     }
//   });
//
//   // Get single task with full result
//   app.get('/api/tasks/:id', (req, res) => {
//     try {
//       const task = db.get(
//         `SELECT t.*, r.name as repo_name, r.full_name as repo_full_name
//          FROM tasks t JOIN repos r ON t.repo_id = r.id WHERE t.id = ?`,
//         [parseInt(req.params.id, 10)]
//       );
//       if (!task) return res.status(404).json({ error: 'Task not found' });
//       return res.json(task);
//     } catch (err) {
//       return res.status(500).json({ error: err.message });
//     }
//   });
//
//   // In the start() function, after db.init():
//   //   await runner.recoverCrashedTasks();
//   //
//   // On process shutdown:
//   //   process.on('SIGTERM', () => { eventManager.shutdown(); process.exit(0); });
// //   process.on('SIGINT', () => { eventManager.shutdown(); process.exit(0); });
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { getPromptForType } = require('./prompts');
const {
  emitTaskStarted,
  emitTaskProgress,
  emitTaskCompleted,
  emitTaskFailed,
  emitNightlyStarted,
  emitNightlyCompleted,
} = require('./sse');

class TaskRunner {
  /**
   * @param {object} db - The db module (with .run, .all, .get helpers)
   * @param {import('./sse').EventManager} eventManager - SSE event manager
   */
  constructor(db, eventManager) {
    this.db = db;
    this.eventManager = eventManager;

    /** Currently running task IDs → { process, timeout, startTime } */
    this.running = new Map();

    /** Queue of task IDs waiting to run */
    this.queue = [];

    /** Maximum concurrent tasks */
    this.maxParallel = config.MAX_PARALLEL || 2;

    /** Timeout per task in milliseconds */
    this.taskTimeout = (config.TASK_TIMEOUT_MIN || 30) * 60 * 1000;

    /** Base temp directory for clones */
    this.tmpBase = path.join('/tmp', 'nightly-ops');
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Execute a single task by ID.
   * Handles the full lifecycle: clone → prompt → spawn → capture → cleanup.
   * @param {number} taskId
   * @returns {Promise<object>} The completed task record
   */
  async runTask(taskId) {
    const task = this.db.get(
      `SELECT t.*, r.name as repo_name, r.full_name as repo_full_name, r.language as repo_language
       FROM tasks t JOIN repos r ON t.repo_id = r.id WHERE t.id = ?`,
      [taskId]
    );

    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.status === 'running') throw new Error(`Task ${taskId} is already running`);

    const repoName = task.repo_name;
    const repoFullName = task.repo_full_name || `Irex777/${repoName}`;
    const taskType = task.task_type;

    // 1. Update status → running
    const startTime = new Date().toISOString();
    this.db.run(
      `UPDATE tasks SET status = 'running', started_at = ?, error = NULL WHERE id = ?`,
      [startTime, taskId]
    );

    emitTaskStarted(this.eventManager, {
      taskId,
      repo: repoName,
      taskType,
    });

    let tmpDir = null;

    try {
      // 2. Clone repo to temp dir
      const timestamp = Date.now();
      tmpDir = path.join(this.tmpBase, `${repoName}-${timestamp}`);
      fs.mkdirSync(tmpDir, { recursive: true });

      await this._cloneRepo(repoFullName, tmpDir);

      // 3. Build prompt from task type
      const promptFn = getPromptForType(taskType);
      if (!promptFn) throw new Error(`Unknown task type: ${taskType}`);

      const prompt = promptFn(repoName);

      // 4-5. Spawn Claude Code and capture output
      const output = await this._runClaudeCode(tmpDir, prompt, taskId, repoName, taskType);

      // 6. Parse and store result
      let parsedResult;
      try {
        parsedResult = this._extractJson(output);
      } catch (_e) {
        parsedResult = { raw_output: output };
      }

      const completedAt = new Date().toISOString();
      const startedAt = new Date(startTime);
      const durationMs = Date.now() - startedAt.getTime();

      this.db.run(
        `UPDATE tasks SET status = 'completed', completed_at = ?, result = ? WHERE id = ?`,
        [completedAt, JSON.stringify(parsedResult), taskId]
      );

      emitTaskCompleted(this.eventManager, {
        taskId,
        repo: repoName,
        taskType,
        result: parsedResult,
        duration: durationMs,
      });

      return this.db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);

    } catch (err) {
      // On failure: store error, mark as 'failed'
      const completedAt = new Date().toISOString();
      const errorMsg = err.message || String(err);

      this.db.run(
        `UPDATE tasks SET status = 'failed', completed_at = ?, error = ? WHERE id = ?`,
        [completedAt, errorMsg, taskId]
      );

      emitTaskFailed(this.eventManager, {
        taskId,
        repo: repoName,
        taskType,
        error: errorMsg,
      });

      console.error(`[runner] Task ${taskId} failed: ${errorMsg}`);
      throw err;

    } finally {
      // 9. Clean up temp dir
      if (tmpDir) {
        this._cleanupDir(tmpDir);
      }
      // Remove from running map
      this.running.delete(taskId);
      // Try to run next queued task
      this._drainQueue();
    }
  }

  /**
   * Run the full nightly batch: iterate enabled repos + enabled task types,
   * create pending tasks, and run them with max parallelism.
   * @returns {Promise<object>} Summary of the nightly run
   */
  async runNightly() {
    console.log('[runner] Starting nightly run...');

    // Find all enabled repos with their enabled task configs
    const repos = this.db.all(`
      SELECT r.* FROM repos r
      WHERE r.enabled = 1
      ORDER BY r.name
    `);

    if (repos.length === 0) {
      return { message: 'No enabled repos found', tasksCreated: 0 };
    }

    const tasksCreated = [];
    const now = new Date().toISOString();

    for (const repo of repos) {
      // Get enabled task types for this repo
      const taskConfigs = this.db.all(
        `SELECT task_type FROM repo_task_config WHERE repo_id = ? AND enabled = 1`,
        [repo.id]
      );

      for (const tc of taskConfigs) {
        // Create a pending task
        this.db.run(
          `INSERT INTO tasks (repo_id, task_type, status, scheduled_at, config)
           VALUES (?, ?, 'pending', ?, ?)`,
          [repo.id, tc.task_type, now, JSON.stringify({ triggered: 'nightly' })]
        );
        const task = this.db.get('SELECT MAX(id) as id FROM tasks');
        tasksCreated.push({
          id: task.id,
          repo: repo.name,
          taskType: tc.task_type,
        });
      }
    }

    if (tasksCreated.length === 0) {
      return { message: 'No tasks configured for enabled repos', tasksCreated: 0 };
    }

    console.log(`[runner] Created ${tasksCreated.length} tasks for ${repos.length} repos`);

    emitNightlyStarted(this.eventManager, {
      taskCount: tasksCreated.length,
      repos: repos.map(r => r.name),
    });

    // Queue all tasks
    for (const t of tasksCreated) {
      this.queue.push(t.id);
    }

    // Start running up to maxParallel tasks
    this._drainQueue();

    return {
      message: `Nightly run started`,
      tasksCreated: tasksCreated.length,
      repos: repos.map(r => r.name),
      tasks: tasksCreated,
    };
  }

  /**
   * Get current queue and running status.
   * @returns {object}
   */
  getQueue() {
    return {
      running: Array.from(this.running.entries()).map(([id, info]) => ({
        taskId: id,
        elapsed: Date.now() - info.startTime,
      })),
      queued: this.queue.slice(),
      maxParallel: this.maxParallel,
    };
  }

  /**
   * Recover any tasks left in 'running' state after a crash.
   * Resets them to 'pending' so they can be re-run.
   */
  async recoverCrashedTasks() {
    const crashed = this.db.all(
      `SELECT id FROM tasks WHERE status = 'running'`
    );
    if (crashed.length === 0) return;

    console.log(`[runner] Recovering ${crashed.length} crashed tasks`);

    for (const task of crashed) {
      this.db.run(
        `UPDATE tasks SET status = 'pending', started_at = NULL, error = 'Recovered from crash' WHERE id = ?`,
        [task.id]
      );
    }
  }

  // ─── Private Methods ─────────────────────────────────────────────────────────

  /**
   * Clone a repo using `gh repo clone`.
   * @param {string} fullName - e.g. "Irex777/nightly-ops"
   * @param {string} destDir - Target directory
   * @returns {Promise<void>}
   */
  _cloneRepo(fullName, destDir) {
    // Read GitHub token from settings for auth
    const tokenRow = this.db.get('SELECT value FROM settings WHERE key = ?', ['github_token']);
    const ghToken = tokenRow ? tokenRow.value : process.env.GH_TOKEN;

    return new Promise((resolve, reject) => {
      const proc = spawn('gh', ['repo', 'clone', fullName, destDir], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120000, // 2 min clone timeout
        env: { ...process.env, GH_TOKEN: ghToken },
      });

      let stderr = '';

      proc.stdout.on('data', (data) => {
        // Clone progress — log but don't need to store
        console.log(`[runner:clone] ${data.toString().trim()}`);
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          console.log(`[runner:clone] Cloned ${fullName} → ${destDir}`);
          resolve();
        } else {
          reject(new Error(`Clone failed (exit ${code}): ${stderr.trim()}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Clone spawn error: ${err.message}`));
      });
    });
  }

  /**
   * Spawn `claude --acp --stdio` and pipe the prompt, capturing stdout.
   * @param {string} workDir - Working directory (cloned repo)
   * @param {string} prompt - The prompt to send
   * @param {number} taskId - Task ID for progress events
   * @param {string} repoName - Repo name for logging
   * @param {string} taskType - Task type for logging
   * @returns {Promise<string>} Captured stdout output
   */
  _runClaudeCode(workDir, prompt, taskId, repoName, taskType) {
    // Build Claude Code env with ZAI/GLM config
    const zaiKey = this.db.get('SELECT value FROM settings WHERE key = ?', ['zai_api_key']);
    const claudeEnv = {
      ...process.env,
      TERM: 'dumb',
      NO_COLOR: '1',
      // GLM via ZAI config
      ANTHROPIC_API_KEY: zaiKey ? zaiKey.value : process.env.ANTHROPIC_API_KEY,
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || 'https://api.z.ai/api/anthropic',
      ANTHROPIC_DEFAULT_SONNET_MODEL: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'glm-5.1',
      ANTHROPIC_DEFAULT_OPUS_MODEL: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL || 'glm-5.1',
      API_TIMEOUT_MS: process.env.API_TIMEOUT_MS || '3000000',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    };

    return new Promise((resolve, reject) => {
      // Use --print mode with --output-format json for structured results
      // --bare: minimal mode, no permission prompts, API key auth only
      const proc = spawn('claude', [
        '-p', prompt,
        '--output-format', 'json',
        '--bare',
        '--model', 'opus',
      ], {
        cwd: workDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: claudeEnv,
      });

      let stdout = '';
      let stderr = '';
      let lastProgressTime = Date.now();

      // Track this running process
      this.running.set(taskId, {
        process: proc,
        startTime: Date.now(),
      });

      // Set timeout
      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        // Give it 5s to clean up, then force kill
        setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch (_e) { /* already dead */ }
        }, 5000);
        reject(new Error(`Task timed out after ${config.TASK_TIMEOUT_MIN} minutes`));
      }, this.taskTimeout);

      proc.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;

        // Emit progress events at most every 2 seconds
        const now = Date.now();
        if (now - lastProgressTime > 2000) {
          lastProgressTime = now;
          // Send last ~500 chars as progress
          const tail = chunk.length > 500 ? chunk.slice(-500) : chunk;
          emitTaskProgress(this.eventManager, {
            taskId,
            output: tail.trim(),
          });
        }
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        // Log stderr but don't fail on it — Claude Code may write debug info
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            console.log(`[runner:claude:${repoName}:${taskType}] stderr: ${line}`);
          }
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        this.running.delete(taskId);

        if (code === 0) {
          console.log(`[runner] Task ${taskId} completed (${repoName}/${taskType})`);
          resolve(stdout);
        } else {
          const errMsg = stderr.trim() || `Process exited with code ${code}`;
          console.error(`[runner] Task ${taskId} exit code ${code}: ${errMsg}`);
          reject(new Error(errMsg));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        this.running.delete(taskId);
        reject(new Error(`Failed to spawn claude: ${err.message}`));
      });
    });
  }

  /**
   * Drain the queue — start tasks up to maxParallel.
   * Each task runs independently; on completion it will call _drainQueue again.
   */
  _drainQueue() {
    while (this.queue.length > 0 && this.running.size < this.maxParallel) {
      const taskId = this.queue.shift();

      // Start task without awaiting — it will self-manage
      this.runTask(taskId).catch((err) => {
        // Error already handled in runTask, just log here
        console.error(`[runner] Unhandled task error for ${taskId}: ${err.message}`);
      });
    }

    // Check if nightly run is complete
    if (this.queue.length === 0 && this.running.size === 0) {
      this._emitNightlyComplete();
    }
  }

  /**
   * Emit nightly_completed event based on recently completed tasks.
   */
  _emitNightlyComplete() {
    try {
      // Find tasks completed in the last 2 hours (reasonable nightly window)
      const recent = this.db.all(`
        SELECT status, COUNT(*) as count FROM tasks
        WHERE completed_at > datetime('now', '-2 hours')
        GROUP BY status
      `);

      let completed = 0;
      let failed = 0;
      let total = 0;
      for (const row of recent) {
        total += row.count;
        if (row.status === 'completed') completed = row.count;
        if (row.status === 'failed') failed = row.count;
      }

      if (total > 0) {
        emitNightlyCompleted(this.eventManager, {
          totalTasks: total,
          completed,
          failed,
          duration: 0, // Total duration is hard to calculate without a nightly run record
        });
      }
    } catch (_err) {
      // Don't let reporting errors break anything
    }
  }

  /**
   * Extract JSON from Claude's output. Looks for JSON blocks.
   * @param {string} output - Raw stdout from Claude
   * @returns {object} Parsed JSON
   */
  _extractJson(output) {
    // Try to find a JSON code block first
    const jsonBlockMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonBlockMatch) {
      return JSON.parse(jsonBlockMatch[1].trim());
    }

    // Try to find raw JSON (looks for { ... } or [ ... ])
    const braceMatch = output.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (braceMatch) {
      return JSON.parse(braceMatch[1]);
    }

    // Last resort: try parsing the whole thing
    return JSON.parse(output.trim());
  }

  /**
   * Recursively remove a directory.
   * @param {string} dirPath
   */
  _cleanupDir(dirPath) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      console.log(`[runner] Cleaned up ${dirPath}`);
    } catch (err) {
      console.warn(`[runner] Failed to clean up ${dirPath}: ${err.message}`);
    }
  }

  /**
   * Cancel a running or queued task.
   * @param {number} taskId
   * @returns {boolean} Whether the task was successfully cancelled
   */
  cancelTask(taskId) {
    // Check if it's in the queue
    const queueIdx = this.queue.indexOf(taskId);
    if (queueIdx !== -1) {
      this.queue.splice(queueIdx, 1);
      this.db.run(
        `UPDATE tasks SET status = 'cancelled', completed_at = ? WHERE id = ?`,
        [new Date().toISOString(), taskId]
      );
      return true;
    }

    // Check if it's currently running
    const runningInfo = this.running.get(taskId);
    if (runningInfo) {
      try {
        runningInfo.process.kill('SIGTERM');
      } catch (_e) { /* already dead */ }
      this.running.delete(taskId);
      this.db.run(
        `UPDATE tasks SET status = 'cancelled', completed_at = ?, error = 'Cancelled by user' WHERE id = ?`,
        [new Date().toISOString(), taskId]
      );
      this._drainQueue();
      return true;
    }

    return false;
  }
}

module.exports = { TaskRunner };
