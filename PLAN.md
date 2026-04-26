# Nightly Ops Dashboard — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task via Claude Code.

**Goal:** Autonomous nightly ops dashboard that manages code reviews, test generation, dependency checks, and Opus-powered feature ideas across all GitHub repos.

**Architecture:** Full autonomous Option B — Express.js + sql.js (WASM SQLite, Docker-safe) + built-in task queue with Claude Code subprocess runner + ZAI API for Opus 4.7 feature ideas. SSE streaming for live progress. Vanilla JS frontend with dark UI.

**Tech Stack:** Node 18, Express, sql.js (WASM SQLite), vanilla JS/CSS, SSE, Claude Code CLI (`claude --acp --stdio`), ZAI GLM API, GitHub API via `gh` CLI.

**Repo:** Irex777/nightly-ops → ops.aiwrk.org

---

## Phase 1: Core App + DB + GitHub Repo Listing

### Task 1.1: Project scaffolding + Express server
- **Create:** `package.json`, `server.js`, `public/index.html`, `public/app.js`, `public/style.css`
- **Create:** `Dockerfile` (node:18-alpine, install sql.js deps)
- Express serves static from `public/`, API routes under `/api/`
- Health check endpoint `GET /api/health`
- PORT from env (default 3000)
- **Verify:** `node -c server.js` && `timeout 3 node server.js` starts without crash

### Task 1.2: SQLite database setup (sql.js)
- **Create:** `db.js` — async init with sql.js, creates tables on first run
- **DB file:** `/app/data/nightly-ops.db` (persistent volume in Docker)
- **Tables:**
  ```sql
  repos (id INTEGER PRIMARY KEY, name TEXT UNIQUE, full_name TEXT, description TEXT, is_private BOOLEAN, language TEXT, enabled BOOLEAN DEFAULT 0, updated_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)
  
  tasks (id INTEGER PRIMARY KEY, repo_id INTEGER, task_type TEXT, status TEXT DEFAULT 'pending', scheduled_at TEXT, started_at TEXT, completed_at TEXT, result TEXT, error TEXT, config TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(repo_id) REFERENCES repos(id))
  
  task_types: 'code_review', 'test_gen', 'dep_check', 'lint_fix', 'feature_ideas', 'perf_audit', 'docs_gen'
  statuses: 'pending', 'running', 'completed', 'failed', 'cancelled'
  
  feature_ideas (id INTEGER PRIMARY KEY, repo_id INTEGER, task_id INTEGER, title TEXT, description TEXT, why TEXT, difficulty TEXT, code_preview TEXT, mock_ui_html TEXT, status TEXT DEFAULT 'proposed', github_issue_url TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(repo_id) REFERENCES repos(id), FOREIGN KEY(task_id) REFERENCES tasks(id))
  
  settings (key TEXT PRIMARY KEY, value TEXT)
  ```
- Export `getDb()` async function, auto-saves to disk after writes
- **Verify:** require db.js, init, query repos table → empty array

### Task 1.3: GitHub API integration — repo sync
- **Create:** `github.js` — uses `gh` CLI to list repos
- `syncRepos()` — runs `gh repo list Irex777 --limit 50 --json name,description,isPrivate,updatedAt,primaryLanguage`
- Upserts into `repos` table (adds new, updates existing, never deletes)
- API route: `POST /api/repos/sync` → triggers sync, returns repo list
- API route: `GET /api/repos` → returns all repos from DB
- **Verify:** `curl -X POST localhost:3000/api/repos/sync` → returns array of repos

### Task 1.4: Frontend — repo listing with toggle
- **Modify:** `public/index.html`, `public/app.js`, `public/style.css`
- Dark theme UI (bg #0a0a0a, cards #1a1a1a, accent #3b82f6)
- Header: "Nightly Ops" with sync button
- Grid of repo cards showing: name, description, language, last updated
- Toggle switch per repo (enabled/disabled) → `PATCH /api/repos/:id` with `{enabled: true/false}`
- Loading states, error handling
- Responsive — works on iPad
- **Verify:** Open in browser, see repo grid, toggle repos on/off, refresh preserves state

---

## Phase 2: Task Config + Built-in Task Runner

### Task 2.1: Task configuration API
- **Create:** `tasks.js` — task management logic
- `GET /api/repos/:id/tasks` — returns configured tasks for a repo
- `PUT /api/repos/:id/tasks` — sets which task types are enabled for a repo
  - Body: `{task_types: ['code_review', 'test_gen', 'feature_ideas']}`
  - Stores in `repos` table as JSON config column, OR a `repo_task_config` table:
    ```sql
    repo_task_config (repo_id INTEGER, task_type TEXT, enabled BOOLEAN DEFAULT 1, schedule TEXT DEFAULT 'nightly', model TEXT, PRIMARY KEY(repo_id, task_type))
    ```
- `GET /api/tasks` — returns all tasks with filtering (status, repo, type)
- `GET /api/tasks/:id` — returns single task with full result
- **Verify:** curl to configure tasks for a repo, read them back

### Task 2.2: Task runner engine
- **Create:** `runner.js` — the core autonomous task runner
- `runTask(task)` — takes a task record, executes it:
  1. Updates task status to 'running'
  2. Clones repo to temp dir (`/tmp/nightly-ops/{repo}-{timestamp}`)
  3. Based on `task_type`, constructs appropriate Claude Code prompt
  4. Spawns `claude --acp --stdio` subprocess with the prompt
  5. Captures stdout/stderr streams
  6. On completion: stores result in task record, cleans up temp dir
  7. On failure: stores error, marks as 'failed'
- `runNightly()` — iterates all enabled repos + enabled task types, creates pending tasks, runs them sequentially (or 2 parallel max)
- `GET /api/tasks/nightly/trigger` — manually trigger nightly run
- **Important:** Use `child_process.spawn` with proper stdio handling, kill on timeout (30min max per task)
- **Verify:** Create a test task manually, run it, see status update

### Task 2.3: Claude Code prompt templates
- **Create:** `prompts.js` — prompt builders for each task type
- **code_review:** "Review the recent commits (last 24h) in this repo. Focus on: bugs, security issues, performance problems, code style. Output a structured JSON review with findings array."
- **test_gen:** "Find files with no corresponding test files. For each, write comprehensive tests. Output: list of files tested, tests written."
- **dep_check:** "Check package.json dependencies for: outdated versions, known vulnerabilities, unused deps. Output structured report."
- **lint_fix:** "Run linting, fix auto-fixable issues. Report remaining manual fixes needed."
- **perf_audit:** "Profile the codebase for performance issues: N+1 queries, memory leaks, expensive loops, missing indexes. Output findings."
- **docs_gen:** "Find undocumented functions/modules. Generate JSDoc comments. Find missing README sections. Output changes."
- Each prompt includes repo context (language, framework, structure)
- **Verify:** require prompts.js, generate prompt for each type → reasonable output

### Task 2.4: Frontend — task config panel per repo
- **Modify:** `public/app.js`, `public/style.css`
- Click repo card → opens detail panel (slide-in from right on mobile)
- Detail shows: task type checkboxes (with icons), schedule selector (nightly/weekly/custom)
- Model selector per task (default: claude-code, feature_ideas: opus-4.7)
- "Run Now" button for individual tasks
- **Verify:** Configure tasks for a repo in browser, see them persisted

---

## Phase 3: Feature Ideas Engine (Opus 4.7)

### Task 3.1: ZAI API integration for Opus 4.7
- **Create:** `ai.js` — ZAI API client using fetch (no SDK needed)
- `generateFeatureIdeas(repoName, repoStructure, recentCommits, readme)`:
  - Uses ZAI coding endpoint: `https://api.z.ai/api/coding/paas/v4`
  - Model: `GLM-4.7` (best reasoning on ZAI coding plan)
  - High max_tokens (16000+) — reasoning model
  - Structured JSON output: array of feature ideas
  - AbortController with 5min timeout
  - Retry logic (2 retries on failure)
- **Create:** `config.js` — reads ZAI_API_KEY from env
- **Verify:** Call with test data → returns feature ideas JSON

### Task 3.2: Feature ideas prompt + parser
- **Modify:** `prompts.js` — add feature_ideas prompt builder
- Prompt: "Analyze this codebase. Propose 3-5 new features that would add the most value. For each: title, description (2-3 sentences), why it makes sense (contextual reasoning), difficulty (S/M/L), code_preview (stub implementation ~20 lines), mock_ui_html (simple HTML/CSS preview of how it could look). Output as JSON array."
- Parser: validates JSON structure, handles truncated responses (bracket repair)
- **Verify:** Generate prompt → reasonable structure

### Task 3.3: Feature ideas storage + API
- **Modify:** `db.js` — feature_ideas table already created in 1.2
- `POST /api/repos/:id/feature-ideas` — trigger generation for a repo
- `GET /api/repos/:id/feature-ideas` — list all ideas for a repo
- `PATCH /api/feature-ideas/:id` — update status (approve/reject/implement)
- `POST /api/feature-ideas/:id/create-issue` — create GitHub issue from idea
  - Uses `gh issue create` with title + body from idea
  - Stores issue URL back in idea record
- **Verify:** curl to trigger generation, list ideas, create issue

### Task 3.4: Frontend — feature ideas viewer
- **Modify:** `public/app.js`, `public/style.css`, `public/index.html`
- New nav tab: "Feature Ideas"
- Grid of idea cards with: title, difficulty badge, description, "Why" expandable
- Code preview panel (syntax-highlighted, simple `<pre>` with monospace)
- Mock UI preview (rendered HTML in iframe sandbox)
- Actions: Approve (creates GH issue), Reject, Re-generate
- Filter by repo, status
- **Verify:** View ideas in browser, approve one → creates GitHub issue

---

## Phase 4: Results Viewer + SSE Streaming + History

### Task 4.1: SSE streaming for live task progress
- **Create:** `sse.js` — Server-Sent Events manager
- `GET /api/tasks/events` — SSE endpoint, sends events:
  - `task_started` {taskId, repo, type}
  - `task_progress` {taskId, output} — streamed Claude Code output lines
  - `task_completed` {taskId, result}
  - `task_failed` {taskId, error}
- EventManager class: manages connections, broadcasts to all listeners
- Heartbeat every 30s to keep connections alive
- **Verify:** Connect via EventSource in browser console → receives events

### Task 4.2: Task results viewer
- **Modify:** `public/app.js`, `public/style.css`
- New nav tab: "Results"
- List view: all tasks, filterable by repo/type/status/date
- Each result shows: repo name, task type icon, status badge, timestamp, duration
- Click → expands to show full output (markdown rendered)
- For code_review: findings listed with severity badges
- For test_gen: test files listed with pass/fail counts
- For feature_ideas: links to idea cards
- **Verify:** Run a task, see it appear in results, expand to see output

### Task 4.3: Dashboard overview
- **Modify:** `public/index.html`, `public/app.js`, `public/style.css`
- Overview tab (default landing):
  - Stats cards: repos monitored, tasks run (24h), issues found, features proposed
  - Activity timeline: recent task completions
  - Active repos list with last-run status
  - Quick actions: "Run Nightly Now", "Sync Repos"
- **Verify:** Dashboard loads with data from actual runs

### Task 4.4: Settings page
- **Modify:** `public/app.js`, `public/style.css`
- Settings tab:
  - Schedule config: nightly time (default 02:00)
  - Max parallel tasks (default 2)
  - Task timeout (default 30 min)
  - ZAI API key (masked input)
  - "Test ZAI Connection" button
  - "Test Claude Code" button
- Stored in `settings` table
- **Verify:** Change settings, reload → persisted

---

## Phase 5: Deploy + Cron

### Task 5.1: Dockerfile + Coolify deploy
- Dockerfile: node:18-alpine, copies app, npm install, exposes PORT
- Coolify: create app, set domain ops.aiwrk.org, persistent volume /app/data
- Env vars: PORT=3000, ZAI_API_KEY, GITHUB_TOKEN (from gh auth)
- **Verify:** Deployed and accessible at ops.aiwrk.org

### Task 5.2: Hermes cron trigger
- Single cron job: `curl -X POST https://ops.aiwrk.org/api/tasks/nightly/trigger?key=SECRET`
- Schedule: 02:00 daily (after Playwright tests at 02:30 — adjust timing)
- App handles the rest internally
- **Verify:** Cron fires, tasks start, results appear in dashboard

---

## Key Design Decisions

1. **sql.js over better-sqlite3**: Docker-safe, no native deps, WASM
2. **Claude Code via subprocess**: `claude --acp --stdio` for autonomous execution
3. **GLM-4.7 for feature ideas**: Best reasoning on ZAI coding plan, handles complex analysis
4. **SSE over WebSocket**: Simpler, no Cloudflare issues, works everywhere
5. **Persistent task queue**: Tasks survive restarts, auto-resume on boot
6. **No auth**: Internal tool, behind Cloudflare. Optional: simple API key for trigger endpoint.
7. **Sequential repo processing**: Avoid resource contention, max 2 parallel tasks
