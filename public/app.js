// app.js — Vanilla JS frontend for Nightly Ops

(function () {
  'use strict';

  // ─── State ──────────────────────────────────────────────────────────────────

  const state = {
    repos: [],
    activeTab: 'repos',
    selectedRepo: null,
  };

  const TASK_TYPES = [
    { key: 'code_review', label: 'Code Review', icon: '🔍' },
    { key: 'test_gen', label: 'Test Generation', icon: '🧪' },
    { key: 'dep_check', label: 'Dependency Check', icon: '📦' },
    { key: 'lint_fix', label: 'Lint Fix', icon: '🧹' },
    { key: 'feature_ideas', label: 'Feature Ideas', icon: '💡' },
    { key: 'perf_audit', label: 'Performance Audit', icon: '⚡' },
    { key: 'docs_gen', label: 'Docs Generation', icon: '📝' },
  ];

  // ─── DOM Refs ───────────────────────────────────────────────────────────────

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    syncBtn: $('#sync-btn'),
    reposGrid: $('#repos-grid'),
    reposLoading: $('#repos-loading'),
    reposEmpty: $('#repos-empty'),
    detailOverlay: $('#detail-overlay'),
    detailPanel: $('#detail-panel'),
    detailClose: $('#detail-close'),
    detailName: $('#detail-name'),
    detailDesc: $('#detail-desc'),
    detailLang: $('#detail-lang'),
    detailUpdated: $('#detail-updated'),
    detailTasks: $('#detail-tasks'),
    toastContainer: $('#toast-container'),
  };

  // ─── API Helpers ────────────────────────────────────────────────────────────

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  // ─── Toast ──────────────────────────────────────────────────────────────────

  function toast(message, type = '') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    dom.toastContainer.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  // ─── Tab Navigation ─────────────────────────────────────────────────────────

  function initTabs() {
    $$('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        $$('.tab').forEach((t) => t.classList.remove('active'));
        $$('.tab-content').forEach((c) => c.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        $(`#tab-${target}`).classList.add('active');
        state.activeTab = target;
      });
    });
  }

  // ─── Repo Rendering ─────────────────────────────────────────────────────────

  function renderRepos() {
    dom.reposLoading.classList.add('hidden');

    if (state.repos.length === 0) {
      dom.reposEmpty.classList.remove('hidden');
      dom.reposGrid.classList.add('hidden');
      return;
    }

    dom.reposEmpty.classList.add('hidden');
    dom.reposGrid.classList.remove('hidden');

    dom.reposGrid.innerHTML = state.repos.map((repo) => `
      <div class="repo-card ${repo.enabled ? 'enabled' : ''}" data-id="${repo.id}">
        <div class="repo-card-top">
          <span class="repo-name">${esc(repo.name)}</span>
          ${repo.is_private ? '<span class="badge badge-private">Private</span>' : ''}
        </div>
        <div class="repo-desc">${esc(repo.description || 'No description')}</div>
        <div class="repo-footer">
          <div class="repo-meta">
            ${repo.language ? `<span class="badge badge-lang">${esc(repo.language)}</span>` : ''}
            <span class="meta-text">${formatDate(repo.updated_at)}</span>
          </div>
          <label class="toggle" title="${repo.enabled ? 'Disable' : 'Enable'}">
            <input type="checkbox" ${repo.enabled ? 'checked' : ''} data-repo-id="${repo.id}">
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    `).join('');

    // Toggle handlers
    dom.reposGrid.querySelectorAll('.toggle input').forEach((input) => {
      input.addEventListener('change', async (e) => {
        e.stopPropagation();
        const id = parseInt(input.dataset.repoId, 10);
        const enabled = input.checked;
        try {
          await api(`/api/repos/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ enabled }),
          });
          const repo = state.repos.find((r) => r.id === id);
          if (repo) repo.enabled = enabled;
          renderRepos();
          toast(`${repo.name} ${enabled ? 'enabled' : 'disabled'}`, 'success');
        } catch (err) {
          input.checked = !enabled;
          toast(err.message, 'error');
        }
      });
    });

    // Card click → detail panel
    dom.reposGrid.querySelectorAll('.repo-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        // Don't open detail if toggle was clicked
        if (e.target.closest('.toggle')) return;
        const id = parseInt(card.dataset.id, 10);
        openDetail(id);
      });
    });
  }

  // ─── Detail Panel ───────────────────────────────────────────────────────────

  function openDetail(repoId) {
    const repo = state.repos.find((r) => r.id === repoId);
    if (!repo) return;

    state.selectedRepo = repo;

    dom.detailName.textContent = repo.name;
    dom.detailDesc.textContent = repo.description || 'No description';
    dom.detailLang.textContent = repo.language || '';
    dom.detailLang.className = repo.language ? 'badge badge-lang' : 'badge hidden';
    dom.detailUpdated.textContent = repo.updated_at
      ? `Updated ${formatDate(repo.updated_at)}`
      : '';

    renderTaskChecklist(repo.id);

    // Show panel
    dom.detailOverlay.classList.remove('hidden');
    dom.detailPanel.classList.remove('hidden');
    requestAnimationFrame(() => {
      dom.detailOverlay.classList.add('visible');
      dom.detailPanel.classList.add('visible');
    });
  }

  function closeDetail() {
    dom.detailOverlay.classList.remove('visible');
    dom.detailPanel.classList.remove('visible');
    setTimeout(() => {
      dom.detailOverlay.classList.add('hidden');
      dom.detailPanel.classList.add('hidden');
    }, 300);
    state.selectedRepo = null;
  }

  async function renderTaskChecklist(repoId) {
    dom.detailTasks.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const configs = await api(`/api/repos/${repoId}/tasks`);
      const enabledMap = {};
      configs.forEach((c) => {
        enabledMap[c.task_type] = c.enabled;
      });

      dom.detailTasks.innerHTML = TASK_TYPES.map((tt) => `
        <label class="task-check">
          <span class="task-check-icon">${tt.icon}</span>
          <input type="checkbox" data-task="${tt.key}" ${enabledMap[tt.key] ? 'checked' : ''}>
          <span class="task-check-label">${tt.label}</span>
        </label>
      `).join('');

      // Save on change
      dom.detailTasks.querySelectorAll('input').forEach((input) => {
        input.addEventListener('change', () => saveTaskConfig(repoId));
      });
    } catch (err) {
      dom.detailTasks.innerHTML = `<p style="color:var(--text-dim);font-size:13px;">Could not load task config.</p>`;
    }
  }

  async function saveTaskConfig(repoId) {
    const checked = dom.detailTasks.querySelectorAll('input:checked');
    const taskTypes = Array.from(checked).map((i) => i.dataset.task);
    try {
      await api(`/api/repos/${repoId}/tasks`, {
        method: 'PUT',
        body: JSON.stringify({ task_types: taskTypes }),
      });
      toast('Task config saved', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ─── Sync ───────────────────────────────────────────────────────────────────

  async function syncRepos() {
    dom.syncBtn.disabled = true;
    dom.syncBtn.querySelector('.btn-icon').textContent = '⟳';
    try {
      const result = await api('/api/repos/sync', { method: 'POST' });
      state.repos = result.repos || [];
      renderRepos();
      const synced = (result.sync || []).length;
      toast(`Synced ${synced} repo(s)`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      dom.syncBtn.disabled = false;
      dom.syncBtn.querySelector('.btn-icon').textContent = '↻';
    }
  }

  // ─── Load Repos ─────────────────────────────────────────────────────────────

  async function loadRepos() {
    try {
      state.repos = await api('/api/repos');
    } catch (err) {
      // On first load, repos might not exist yet — that's fine
      state.repos = [];
    }
    renderRepos();
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      const now = new Date();
      const diffMs = now - d;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 30) return `${diffDays}d ago`;
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  }

  // ─── Init ───────────────────────────────────────────────────────────────────

  function init() {
    initTabs();

    dom.syncBtn.addEventListener('click', syncRepos);
    dom.detailClose.addEventListener('click', closeDetail);
    dom.detailOverlay.addEventListener('click', closeDetail);

    // Close detail on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDetail();
    });

    loadRepos();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
