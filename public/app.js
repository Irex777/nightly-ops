// app.js — Vanilla JS frontend for Nightly Ops

(function () {
  'use strict';

  // ─── State ──────────────────────────────────────────────────────────────────

  const state = {
    repos: [],
    ideas: [],
    tasks: [],
    settings: {},
    activeTab: 'repos',
    selectedRepo: null,
    selectedIdea: null,
    selectedTask: null,
    sse: null,
    ideasLoaded: false,
    tasksLoaded: false,
    settingsLoaded: false,
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
    // Repos
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
    // Ideas
    ideasRepoFilter: $('#ideas-repo-filter'),
    ideasDifficultyFilter: $('#ideas-difficulty-filter'),
    ideasStatusFilter: $('#ideas-status-filter'),
    generateIdeasBtn: $('#generate-ideas-btn'),
    ideasLoading: $('#ideas-loading'),
    ideasEmpty: $('#ideas-empty'),
    ideasGrid: $('#ideas-grid'),
    genOverlay: $('#gen-overlay'),
    genModal: $('#gen-modal'),
    genRepoSelect: $('#gen-repo-select'),
    genCancel: $('#gen-cancel'),
    genConfirm: $('#gen-confirm'),
    ideaOverlay: $('#idea-overlay'),
    ideaPanel: $('#idea-panel'),
    ideaTitle: $('#idea-title'),
    ideaDifficulty: $('#idea-difficulty'),
    ideaStatus: $('#idea-status'),
    ideaRepo: $('#idea-repo'),
    ideaDescription: $('#idea-description'),
    ideaWhy: $('#idea-why'),
    ideaCode: $('#idea-code'),
    ideaMockIframe: $('#idea-mock-iframe'),
    ideaClose: $('#idea-close'),
    ideaCreateIssue: $('#idea-create-issue'),
    ideaReject: $('#idea-reject'),
    // Results
    resultsStatusFilter: $('#results-status-filter'),
    resultsTypeFilter: $('#results-type-filter'),
    resultsRepoFilter: $('#results-repo-filter'),
    runNightlyBtn: $('#run-nightly-btn'),
    resultsLoading: $('#results-loading'),
    resultsEmpty: $('#results-empty'),
    resultsList: $('#results-list'),
    resultOverlay: $('#result-overlay'),
    resultPanel: $('#result-panel'),
    resultTitle: $('#result-title'),
    resultStatus: $('#result-status'),
    resultType: $('#result-type'),
    resultTime: $('#result-time'),
    resultOutput: $('#result-output'),
    resultLive: $('#result-live'),
    resultClose: $('#result-close'),
    // Settings
    settingSchedule: $('#setting-schedule'),
    settingParallel: $('#setting-parallel'),
    settingTimeout: $('#setting-timeout'),
    settingZaiKey: $('#setting-zai-key'),
    testZaiBtn: $('#test-zai-btn'),
    zaiTestResult: $('#zai-test-result'),
    testClaudeBtn: $('#test-claude-btn'),
    claudeTestResult: $('#claude-test-result'),
    saveSettingsBtn: $('#save-settings-btn'),
    // SSE
    sseStatus: $('#sse-status'),
    // Global
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
        onTabSwitch(target);
      });
    });
  }

  function onTabSwitch(tab) {
    if (tab === 'ideas' && !state.ideasLoaded) loadIdeas();
    if (tab === 'results' && !state.tasksLoaded) loadTasks();
    if (tab === 'settings' && !state.settingsLoaded) loadSettings();
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

  // ─── Filter Population ──────────────────────────────────────────────────────

  function populateFilters() {
    // Ideas repo filter
    populateRepoSelect(dom.ideasRepoFilter, 'All repos');
    // Results filters
    populateRepoSelect(dom.resultsRepoFilter, 'All repos');
    populateTaskTypeFilter();
    // Generate ideas modal repo select
    populateRepoSelect(dom.genRepoSelect, '— Select a repo —', true);
  }

  function populateRepoSelect(selectEl, allLabel, enabledOnly) {
    const repos = enabledOnly ? state.repos.filter((r) => r.enabled) : state.repos;
    selectEl.innerHTML = `<option value="all">${allLabel}</option>` +
      repos.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
  }

  function populateTaskTypeFilter() {
    dom.resultsTypeFilter.innerHTML = '<option value="all">All types</option>' +
      TASK_TYPES.map((tt) => `<option value="${tt.key}">${tt.icon} ${esc(tt.label)}</option>`).join('');
  }

  // ─── Ideas Tab ──────────────────────────────────────────────────────────────

  function openGenModal() {
    populateRepoSelect(dom.genRepoSelect, '— Select a repo —', true);
    dom.genOverlay.classList.remove('hidden');
    dom.genModal.classList.remove('hidden');
    requestAnimationFrame(() => {
      dom.genOverlay.classList.add('visible');
      dom.genModal.classList.add('visible');
    });
  }

  function closeGenModal() {
    dom.genOverlay.classList.remove('visible');
    dom.genModal.classList.remove('visible');
    setTimeout(() => {
      dom.genOverlay.classList.add('hidden');
      dom.genModal.classList.add('hidden');
    }, 300);
  }

  async function confirmGenerateIdeas() {
    const repoId = dom.genRepoSelect.value;
    if (!repoId || repoId === 'all') {
      toast('Please select a repo', 'error');
      return;
    }
    closeGenModal();
    dom.ideasLoading.classList.remove('hidden');
    dom.ideasGrid.classList.add('hidden');
    dom.ideasEmpty.classList.add('hidden');
    try {
      await api(`/api/repos/${repoId}/feature-ideas`, { method: 'POST' });
      toast('Ideas generated successfully', 'success');
      state.ideasLoaded = false;
      await loadIdeas();
    } catch (err) {
      toast(err.message, 'error');
      dom.ideasLoading.classList.add('hidden');
    }
  }

  async function loadIdeas() {
    dom.ideasLoading.classList.remove('hidden');
    dom.ideasGrid.classList.add('hidden');
    dom.ideasEmpty.classList.add('hidden');
    try {
      const enabledRepos = state.repos.filter((r) => r.enabled);
      const allIdeas = [];
      await Promise.all(enabledRepos.map(async (repo) => {
        try {
          const ideas = await api(`/api/repos/${repo.id}/feature-ideas`);
          ideas.forEach((idea) => { idea._repoName = repo.name; });
          allIdeas.push(...ideas);
        } catch (_) { /* repo may have no ideas */ }
      }));
      state.ideas = allIdeas;
      state.ideasLoaded = true;
    } catch (err) {
      toast('Failed to load ideas: ' + err.message, 'error');
    }
    dom.ideasLoading.classList.add('hidden');
    renderIdeas();
  }

  function renderIdeas() {
    const repoFilter = dom.ideasRepoFilter.value;
    const diffFilter = dom.ideasDifficultyFilter.value;
    const statusFilter = dom.ideasStatusFilter.value;

    let filtered = state.ideas;
    if (repoFilter !== 'all') filtered = filtered.filter((i) => String(i.repo_id) === repoFilter);
    if (diffFilter !== 'all') filtered = filtered.filter((i) => i.difficulty === diffFilter);
    if (statusFilter !== 'all') filtered = filtered.filter((i) => i.status === statusFilter);

    if (filtered.length === 0) {
      dom.ideasEmpty.classList.remove('hidden');
      dom.ideasGrid.classList.add('hidden');
      return;
    }

    dom.ideasEmpty.classList.add('hidden');
    dom.ideasGrid.classList.remove('hidden');

    dom.ideasGrid.innerHTML = filtered.map((idea) => {
      const diffClass = `badge-difficulty-${(idea.difficulty || 'S')}`;
      const statusClass = `badge-status-${idea.status || 'proposed'}`;
      return `
        <div class="idea-card" data-id="${idea.id}">
          <div class="idea-card-header">
            <span class="idea-card-title">${esc(idea.title || 'Untitled')}</span>
          </div>
          <p class="idea-card-desc">${esc(truncate(idea.description || '', 120))}</p>
          <div class="idea-card-footer">
            <span class="badge ${diffClass}">${esc(idea.difficulty || 'S')}</span>
            <span class="badge ${statusClass}">${esc(idea.status || 'proposed')}</span>
            <span class="meta-text">${esc(idea._repoName || '')}</span>
          </div>
        </div>`;
    }).join('');

    dom.ideasGrid.querySelectorAll('.idea-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = parseInt(card.dataset.id, 10);
        openIdeaPanel(id);
      });
    });
  }

  function openIdeaPanel(ideaId) {
    const idea = state.ideas.find((i) => i.id === ideaId);
    if (!idea) return;
    state.selectedIdea = idea;

    dom.ideaTitle.textContent = idea.title || 'Untitled';
    dom.ideaDifficulty.textContent = idea.difficulty || 'S';
    dom.ideaDifficulty.className = `badge badge-difficulty-${(idea.difficulty || 'S')}`;
    dom.ideaStatus.textContent = idea.status || 'proposed';
    dom.ideaStatus.className = `badge badge-status-${idea.status || 'proposed'}`;
    dom.ideaRepo.textContent = idea._repoName || '';

    dom.ideaDescription.textContent = idea.description || 'No description available.';
    dom.ideaWhy.textContent = idea.why || 'No rationale provided.';

    // Code preview
    if (idea.code_preview) {
      const codeBlock = dom.ideaCode;
      codeBlock.textContent = idea.code_preview;
      codeBlock.parentElement.style.display = '';
    } else {
      dom.ideaCode.parentElement.style.display = 'none';
    }

    // Mock UI iframe
    if (idea.mock_ui_html) {
      dom.ideaMockIframe.srcdoc = idea.mock_ui_html;
      dom.ideaMockIframe.parentElement.style.display = '';
    } else {
      dom.ideaMockIframe.parentElement.style.display = 'none';
    }

    // Show/hide action buttons based on status
    const canAct = idea.status === 'proposed' || idea.status === 'approved';
    dom.ideaCreateIssue.style.display = (idea.status === 'implemented') ? 'none' : '';
    dom.ideaReject.style.display = (idea.status === 'rejected' || idea.status === 'implemented') ? 'none' : '';

    showPanel(dom.ideaOverlay, dom.ideaPanel);
  }

  function closeIdeaPanel() {
    hidePanel(dom.ideaOverlay, dom.ideaPanel);
    state.selectedIdea = null;
  }

  async function createIssueFromIdea() {
    if (!state.selectedIdea) return;
    const idea = state.selectedIdea;
    dom.ideaCreateIssue.disabled = true;
    try {
      await api(`/api/feature-ideas/${idea.id}/create-issue`, { method: 'POST' });
      idea.status = 'implemented';
      toast('GitHub issue created', 'success');
      closeIdeaPanel();
      renderIdeas();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      dom.ideaCreateIssue.disabled = false;
    }
  }

  async function rejectIdea() {
    if (!state.selectedIdea) return;
    const idea = state.selectedIdea;
    dom.ideaReject.disabled = true;
    try {
      await api(`/api/feature-ideas/${idea.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'rejected' }),
      });
      idea.status = 'rejected';
      toast('Idea rejected', 'success');
      closeIdeaPanel();
      renderIdeas();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      dom.ideaReject.disabled = false;
    }
  }

  // ─── Results Tab ────────────────────────────────────────────────────────────

  async function loadTasks() {
    dom.resultsLoading.classList.remove('hidden');
    dom.resultsList.classList.add('hidden');
    dom.resultsEmpty.classList.add('hidden');
    try {
      const data = await api('/api/tasks?limit=50');
      state.tasks = Array.isArray(data) ? data : (data.tasks || []);
      state.tasksLoaded = true;
    } catch (err) {
      toast('Failed to load tasks: ' + err.message, 'error');
    }
    dom.resultsLoading.classList.add('hidden');
    renderTasks();
  }

  function renderTasks() {
    const statusFilter = dom.resultsStatusFilter.value;
    const typeFilter = dom.resultsTypeFilter.value;
    const repoFilter = dom.resultsRepoFilter.value;

    let filtered = state.tasks;
    if (statusFilter !== 'all') filtered = filtered.filter((t) => t.status === statusFilter);
    if (typeFilter !== 'all') filtered = filtered.filter((t) => t.task_type === typeFilter);
    if (repoFilter !== 'all') filtered = filtered.filter((t) => String(t.repo_id) === repoFilter);

    if (filtered.length === 0) {
      dom.resultsEmpty.classList.remove('hidden');
      dom.resultsList.classList.add('hidden');
      return;
    }

    dom.resultsEmpty.classList.add('hidden');
    dom.resultsList.classList.remove('hidden');

    dom.resultsList.innerHTML = filtered.map((task) => {
      const tt = TASK_TYPES.find((t) => t.key === task.task_type);
      const icon = tt ? tt.icon : '📋';
      const label = tt ? tt.label : task.task_type;
      const statusClass = `badge-status-${task.status || 'pending'}`;
      const duration = formatDuration(task.started_at, task.completed_at);
      const repo = state.repos.find((r) => r.id === task.repo_id);
      const repoName = repo ? repo.name : (task.repo_name || `Repo #${task.repo_id}`);

      return `
        <div class="result-item" data-id="${task.id}">
          <div class="result-item-icon">${icon}</div>
          <div class="result-item-body">
            <div class="result-item-title">${esc(label)}</div>
            <div class="result-item-meta">
              <span class="meta-text">${esc(repoName)}</span>
              <span class="meta-text">${formatDate(task.created_at)}</span>
              ${duration ? `<span class="meta-text">${duration}</span>` : ''}
            </div>
          </div>
          <span class="badge ${statusClass}">${esc(task.status || 'pending')}</span>
        </div>`;
    }).join('');

    dom.resultsList.querySelectorAll('.result-item').forEach((item) => {
      item.addEventListener('click', () => {
        const id = parseInt(item.dataset.id, 10);
        openResultPanel(id);
      });
    });
  }

  async function openResultPanel(taskId) {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;
    state.selectedTask = task;

    const tt = TASK_TYPES.find((t) => t.key === task.task_type);
    const label = tt ? tt.label : task.task_type;

    dom.resultTitle.textContent = label;
    dom.resultStatus.textContent = task.status || 'pending';
    dom.resultStatus.className = `badge badge-status-${task.status || 'pending'}`;
    dom.resultType.textContent = task.task_type || '';
    dom.resultTime.textContent = task.created_at ? formatDate(task.created_at) : '';

    if (task.status === 'running' || task.status === 'pending') {
      dom.resultLive.classList.remove('hidden');
      dom.resultOutput.textContent = task.result || 'Waiting for output…';
    } else {
      dom.resultLive.classList.add('hidden');
      try {
        const full = await api(`/api/tasks/${task.id}`);
        const resultData = full.result || full.output || full;
        dom.resultOutput.textContent = typeof resultData === 'string'
          ? resultData
          : JSON.stringify(resultData, null, 2);
      } catch (_) {
        dom.resultOutput.textContent = task.result || 'No output available.';
      }
    }

    showPanel(dom.resultOverlay, dom.resultPanel);
  }

  function closeResultPanel() {
    hidePanel(dom.resultOverlay, dom.resultPanel);
    state.selectedTask = null;
  }

  async function triggerNightlyRun() {
    dom.runNightlyBtn.disabled = true;
    try {
      await api('/api/tasks/nightly/trigger', { method: 'POST' });
      toast('Nightly run triggered', 'success');
      state.tasksLoaded = false;
      await loadTasks();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      dom.runNightlyBtn.disabled = false;
    }
  }

  // ─── Settings Tab ───────────────────────────────────────────────────────────

  async function loadSettings() {
    try {
      const settings = await api('/api/settings');
      state.settings = settings;
      state.settingsLoaded = true;

      if (settings.schedule_time) dom.settingSchedule.value = settings.schedule_time;
      if (settings.max_parallel) dom.settingParallel.value = settings.max_parallel;
      if (settings.task_timeout) dom.settingTimeout.value = settings.task_timeout;
      if (settings.zai_api_key) dom.settingZaiKey.value = settings.zai_api_key;
    } catch (err) {
      toast('Failed to load settings: ' + err.message, 'error');
    }
  }

  async function saveSettings() {
    dom.saveSettingsBtn.disabled = true;
    try {
      await api('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          schedule_time: dom.settingSchedule.value,
          max_parallel: parseInt(dom.settingParallel.value, 10),
          task_timeout: parseInt(dom.settingTimeout.value, 10),
          zai_api_key: dom.settingZaiKey.value,
        }),
      });
      toast('Settings saved', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      dom.saveSettingsBtn.disabled = false;
    }
  }

  async function testZai() {
    dom.testZaiBtn.disabled = true;
    dom.zaiTestResult.classList.remove('hidden', 'success', 'error');
    dom.zaiTestResult.textContent = 'Testing…';
    try {
      const result = await api('/api/settings/test-zai', { method: 'POST' });
      dom.zaiTestResult.textContent = result.message || (result.ok ? 'Connection successful!' : 'Connection failed');
      dom.zaiTestResult.classList.add(result.ok ? 'success' : 'error');
    } catch (err) {
      dom.zaiTestResult.textContent = err.message;
      dom.zaiTestResult.classList.add('error');
    } finally {
      dom.testZaiBtn.disabled = false;
    }
  }

  async function testClaude() {
    dom.testClaudeBtn.disabled = true;
    dom.claudeTestResult.classList.remove('hidden', 'success', 'error');
    dom.claudeTestResult.textContent = 'Testing…';
    try {
      const result = await api('/api/settings/test-claude', { method: 'POST' });
      dom.claudeTestResult.textContent = result.message || (result.ok ? 'Claude Code available!' : 'Claude Code not found');
      dom.claudeTestResult.classList.add(result.ok ? 'success' : 'error');
    } catch (err) {
      dom.claudeTestResult.textContent = err.message;
      dom.claudeTestResult.classList.add('error');
    } finally {
      dom.testClaudeBtn.disabled = false;
    }
  }

  // ─── SSE Connection ────────────────────────────────────────────────────────

  function connectSSE() {
    if (state.sse) { state.sse.close(); }
    try {
      const es = new EventSource('/api/tasks/events');
      state.sse = es;

      es.onopen = () => {
        dom.sseStatus.classList.add('connected');
        dom.sseStatus.title = 'SSE connected';
      };

      es.onerror = () => {
        dom.sseStatus.classList.remove('connected');
        dom.sseStatus.title = 'SSE disconnected — reconnecting…';
        // Auto-reconnect is handled by EventSource
      };

      // Task lifecycle events
      es.addEventListener('task_started', (e) => {
        handleSSEEvent('task_started', e);
      });
      es.addEventListener('task_progress', (e) => {
        handleSSEEvent('task_progress', e);
      });
      es.addEventListener('task_completed', (e) => {
        handleSSEEvent('task_completed', e);
      });
      es.addEventListener('task_failed', (e) => {
        handleSSEEvent('task_failed', e);
      });

      // Nightly events
      es.addEventListener('nightly_started', (e) => {
        handleSSEEvent('nightly_started', e);
      });
      es.addEventListener('nightly_completed', (e) => {
        handleSSEEvent('nightly_completed', e);
      });

      // Idea events
      es.addEventListener('ideas_generated', (e) => {
        handleSSEEvent('ideas_generated', e);
      });
      es.addEventListener('issue_created', (e) => {
        handleSSEEvent('issue_created', e);
      });
    } catch (_) {
      // SSE not supported or server unreachable
      dom.sseStatus.title = 'SSE unavailable';
    }
  }

  function handleSSEEvent(type, event) {
    let data;
    try { data = JSON.parse(event.data); } catch (_) { data = {}; }

    switch (type) {
      case 'task_started':
      case 'task_progress':
      case 'task_completed':
      case 'task_failed':
        if (state.activeTab === 'results') {
          state.tasksLoaded = false;
          loadTasks();
        }
        // If viewing this task's result panel, update live
        if (state.selectedTask && data.task_id === state.selectedTask.id) {
          if (type === 'task_progress' && data.output) {
            dom.resultOutput.textContent += '\n' + data.output;
            dom.resultOutput.scrollTop = dom.resultOutput.scrollHeight;
          }
          if (type === 'task_completed' || type === 'task_failed') {
            dom.resultLive.classList.add('hidden');
            state.selectedTask.status = type === 'task_completed' ? 'completed' : 'failed';
            dom.resultStatus.textContent = state.selectedTask.status;
            dom.resultStatus.className = `badge badge-status-${state.selectedTask.status}`;
            if (data.result) {
              dom.resultOutput.textContent = typeof data.result === 'string'
                ? data.result
                : JSON.stringify(data.result, null, 2);
            }
          }
        }
        if (type === 'task_completed') toast(`Task completed: ${data.task_type || 'task'}`, 'success');
        if (type === 'task_failed') toast(`Task failed: ${data.error || 'unknown error'}`, 'error');
        break;

      case 'nightly_started':
        toast('Nightly run started', 'success');
        break;
      case 'nightly_completed':
        toast('Nightly run completed', 'success');
        if (state.activeTab === 'results') {
          state.tasksLoaded = false;
          loadTasks();
        }
        break;

      case 'ideas_generated':
        toast(`Ideas generated for ${data.repo_name || 'repo'}`, 'success');
        if (state.activeTab === 'ideas') {
          state.ideasLoaded = false;
          loadIdeas();
        }
        break;

      case 'issue_created':
        toast(`GitHub issue created: ${data.title || ''}`, 'success');
        if (state.activeTab === 'ideas') {
          state.ideasLoaded = false;
          loadIdeas();
        }
        break;
    }
  }

  // ─── Panel Helpers ─────────────────────────────────────────────────────────

  function showPanel(overlay, panel) {
    overlay.classList.remove('hidden');
    panel.classList.remove('hidden');
    requestAnimationFrame(() => {
      overlay.classList.add('visible');
      panel.classList.add('visible');
    });
  }

  function hidePanel(overlay, panel) {
    overlay.classList.remove('visible');
    panel.classList.remove('visible');
    setTimeout(() => {
      overlay.classList.add('hidden');
      panel.classList.add('hidden');
    }, 300);
  }

  // ─── Extra Helpers ─────────────────────────────────────────────────────────

  function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '…' : str;
  }

  function formatDuration(start, end) {
    if (!start) return '';
    const s = new Date(start);
    const e = end ? new Date(end) : new Date();
    const diffSec = Math.round((e - s) / 1000);
    if (diffSec < 60) return `${diffSec}s`;
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ${diffSec % 60}s`;
    return `${Math.floor(diffSec / 3600)}h ${Math.floor((diffSec % 3600) / 60)}m`;
  }

  // ─── Init ───────────────────────────────────────────────────────────────────

  function init() {
    initTabs();

    // Repos
    dom.syncBtn.addEventListener('click', syncRepos);
    dom.detailClose.addEventListener('click', closeDetail);
    dom.detailOverlay.addEventListener('click', closeDetail);

    // Ideas
    dom.generateIdeasBtn.addEventListener('click', openGenModal);
    dom.genCancel.addEventListener('click', closeGenModal);
    dom.genOverlay.addEventListener('click', closeGenModal);
    dom.genConfirm.addEventListener('click', confirmGenerateIdeas);
    dom.ideasRepoFilter.addEventListener('change', renderIdeas);
    dom.ideasDifficultyFilter.addEventListener('change', renderIdeas);
    dom.ideasStatusFilter.addEventListener('change', renderIdeas);
    dom.ideaClose.addEventListener('click', closeIdeaPanel);
    dom.ideaOverlay.addEventListener('click', closeIdeaPanel);
    dom.ideaCreateIssue.addEventListener('click', createIssueFromIdea);
    dom.ideaReject.addEventListener('click', rejectIdea);

    // Results
    dom.resultsStatusFilter.addEventListener('change', renderTasks);
    dom.resultsTypeFilter.addEventListener('change', renderTasks);
    dom.resultsRepoFilter.addEventListener('change', renderTasks);
    dom.runNightlyBtn.addEventListener('click', triggerNightlyRun);
    dom.resultClose.addEventListener('click', closeResultPanel);
    dom.resultOverlay.addEventListener('click', closeResultPanel);

    // Settings
    dom.saveSettingsBtn.addEventListener('click', saveSettings);
    dom.testZaiBtn.addEventListener('click', testZai);
    dom.testClaudeBtn.addEventListener('click', testClaude);

    // Close any open panel on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeDetail();
        closeIdeaPanel();
        closeResultPanel();
        closeGenModal();
      }
    });

    loadRepos();
    populateFilters();
    connectSSE();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
