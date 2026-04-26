# Nightly Ops Dashboard — Implementation Plan

> **For Hermes:** Use subagent-driven-development to implement this plan task-by-task.

**Goal:** Web dashboard at ops.aiwrk.org to configure and view nightly automated workflows (code review, tests, feature ideas) across all GitHub repos.

**Architecture:** Express.js + vanilla JS SPA + sql.js (WASM SQLite, Docker-safe). Single-page dark UI. Hermes cron triggers task execution. Dashboard is config + results viewer.

**Tech Stack:** Node 18, Express, sql.js, GitHub API (gh CLI + REST), vanilla JS ES modules, CSS dark theme

---

## Phase 1: Core App Foundation

### Task 1.1: Initialize project with Express + sql.js + dark UI skeleton
- Create `package.json` with express, sql.js, node-cron
- Create `server.js` with Express server, sql.js DB init, static serving
- Create `public/index.html` — dark themed SPA shell with sidebar nav
- Create `public/style.css` — dark theme matching existing projects
- Create `public/app.js` — ES module, router placeholder
- DB schema: repos, tasks, runs, feature_ideas tables
- `node -c server.js` verification

### Task 1.2: GitHub repos API — list and sync
- `GET /api/repos` — list all repos from GitHub via `gh` CLI or REST API
- `GET /api/repos/sync` — fetch from GitHub, upsert into local DB
- Store: name, description, private, language, updatedAt, active (bool)
- Frontend: Repos page — grid of repo cards with toggle switches

### Task 1.3: Repo configuration — toggle active, select tasks
- `PATCH /api/repos/:name` — update active status, task config
- Per-repo config: which tasks enabled (code_review, test_gen, dep_check, lint_fix, feature_ideas, perf_audit, docs_gen)
- Frontend: clicking a repo card opens config panel with task toggles

## Phase 2: Task Config + Scheduling

### Task 2.1: Task definitions and scheduling UI
- `GET /api/tasks` — list available task types with descriptions
- `GET /api/schedule` — get current cron schedule config
- `POST /api/schedule` — update schedule (time, frequency)
- Frontend: Schedule page — time picker, frequency selector, global on/off

### Task 2.2: Run management API
- `POST /api/runs/trigger` — manually trigger a run for selected repos/tasks
- `GET /api/runs` — list past runs with status, timestamps, summary
- `GET /api/runs/:id` — get detailed run results
- Run states: pending, running, completed, failed

## Phase 3: Feature Ideas Engine (Opus 4.7)

### Task 3.1: Feature ideas generation endpoint
- `POST /api/feature-ideas/generate/:repo` — trigger Opus 4.7 analysis
- Uses ZAI API (GLM-4.7) to analyze repo and propose features
- Input: repo structure, README, recent commits, existing issues
- Output: 3-5 feature proposals with name, description, rationale, difficulty, code stub
- Async pattern: return jobId, poll for completion (Opus can take 60-120s)

### Task 3.2: Feature ideas viewer UI
- `GET /api/feature-ideas/:repo` — list ideas for a repo
- `PATCH /api/feature-ideas/:id` — approve/reject/archive idea
- `POST /api/feature-ideas/:id/create-issue` — create GitHub issue from idea
- Frontend: Ideas page — cards with feature preview, approve/reject buttons
- Each idea card shows: title, description, why, difficulty badge, code snippet preview

## Phase 4: Results Viewer + History

### Task 4.1: Run results display
- Frontend: Results page — table of past runs, filterable by repo/task/status
- Click a run → expandable detail view with findings
- Code review results: file list, issues found, suggestions
- Test gen results: files created, tests passing
- Dep check results: outdated/vulnerable packages list

### Task 4.2: Dashboard overview page
- Summary stats: total repos, active repos, runs this week, issues found, features proposed
- Recent activity feed
- Quick action buttons: trigger all, sync repos, generate ideas

## Phase 5: Hermes Cron Integration

### Task 5.1: Cron execution bridge
- Endpoint `POST /api/cron/execute` — called by Hermes nightly cron
- Reads active repos + enabled tasks from DB
- Executes tasks sequentially per repo
- For Claude Code tasks: delegates via Hermes delegate_task
- For feature ideas: calls Opus 4.7 directly
- Stores all results in DB

## Phase 6: Deploy + Polish

### Task 6.1: Docker setup + Coolify deploy
- Dockerfile (node:18-alpine)
- Deploy to ops.aiwrk.org via Coolify API
- Persistent volume for DB
- Environment vars: GH_TOKEN, ZAI_API_KEY, etc.

### Task 6.2: Auth (simple session-based)
- Single admin user (env vars for credentials)
- Session cookie auth on all /api routes
- Login page

---

## DB Schema

```sql
CREATE TABLE repos (
  name TEXT PRIMARY KEY,
  description TEXT,
  private INTEGER DEFAULT 0,
  language TEXT,
  updated_at TEXT,
  active INTEGER DEFAULT 0,
  task_config TEXT, -- JSON: {"code_review":true,"test_gen":false,...}
  synced_at TEXT
);

CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT,
  task_type TEXT,
  status TEXT DEFAULT 'pending',
  started_at TEXT,
  completed_at TEXT,
  result TEXT, -- JSON with findings
  error TEXT,
  FOREIGN KEY (repo) REFERENCES repos(name)
);

CREATE TABLE feature_ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT,
  title TEXT,
  description TEXT,
  rationale TEXT,
  difficulty TEXT, -- S/M/L
  code_stub TEXT,
  mockup TEXT,
  status TEXT DEFAULT 'proposed', -- proposed/approved/rejected/archived
  created_at TEXT,
  github_issue_url TEXT,
  FOREIGN KEY (repo) REFERENCES repos(name)
);

CREATE TABLE schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time TEXT, -- "02:00"
  frequency TEXT, -- daily/weekly
  enabled INTEGER DEFAULT 1
);
```

## API Endpoints Summary

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/login | Admin login |
| GET | /api/repos | List repos |
| POST | /api/repos/sync | Sync from GitHub |
| PATCH | /api/repos/:name | Update repo config |
| GET | /api/tasks | List task types |
| GET | /api/schedule | Get schedule |
| POST | /api/schedule | Update schedule |
| POST | /api/runs/trigger | Trigger manual run |
| GET | /api/runs | List runs |
| GET | /api/runs/:id | Run details |
| POST | /api/feature-ideas/generate/:repo | Generate ideas |
| GET | /api/feature-ideas/:repo | List ideas |
| PATCH | /api/feature-ideas/:id | Update idea status |
| POST | /api/feature-ideas/:id/create-issue | Create GH issue |
| POST | /api/cron/execute | Cron trigger |
| GET | /api/dashboard | Overview stats |
