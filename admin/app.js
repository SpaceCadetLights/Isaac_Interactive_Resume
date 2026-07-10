import {
  buildResumeAiPrompt,
  getAdminCategories,
  collectAllTags,
  categoryLabel,
  slugifyCategory,
  DEFAULT_CATEGORIES,
  DEFAULT_ENTRY_KINDS,
  ENTRY_KIND_LABELS,
  entryKindLabel,
} from './resume-pack-schema.js';

let API_BASE = '';
let MEDIA_BASE = '';
let PORTFOLIO_URL = '';
const TOKEN_KEY = 'portfolio_admin_token';

function getToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

function setToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch (_) {}
}

async function loadConfig() {
  try {
    const r = await fetch('config.json', { cache: 'no-store' });
    if (r.ok) {
      const c = await r.json();
      if (c.apiBaseUrl) API_BASE = c.apiBaseUrl.replace(/\/$/, '');
      if (c.portfolioUrl) PORTFOLIO_URL = c.portfolioUrl;
    }
  } catch (_) {}
  if (!API_BASE) {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      API_BASE = 'http://localhost:8787';
      if (!PORTFOLIO_URL) PORTFOLIO_URL = 'http://localhost:8000/portfolio/';
    } else if (host.endsWith('.workers.dev')) {
      API_BASE = window.location.origin;
    }
  }
  if (!PORTFOLIO_URL) PORTFOLIO_URL = 'https://resume.spacecadetslighting.com/portfolio/';
}

function wireSiteLinks(url) {
  const portfolioUrl = url || PORTFOLIO_URL;
  if (!portfolioUrl) return;
  PORTFOLIO_URL = portfolioUrl;
  for (const id of ['link-view-site', 'link-back-portfolio']) {
    const el = document.getElementById(id);
    if (el) {
      el.href = portfolioUrl;
      if (id === 'link-view-site') el.textContent = 'View site';
    }
  }
}

function renderImportReport(container, data) {
  if (!container || !data?.analysis) return;
  const a = data.analysis;
  const s = a.summary || {};
  const lines = [];
  lines.push(`<p><strong>Summary:</strong> ${s.incoming || 0} incoming · ${s.created || 0} new · ${s.updated || 0} text updates · ${s.unchanged || 0} unchanged · ${s.orphaned || 0} not in JSON</p>`);

  if (data.resume?.willReplace) {
    lines.push('<p class="muted small">Resume + timeline JSON will replace cloud copy. Project <em>photos</em> stay in the database by <code>slug</code>.</p>');
  }

  if (a.orphaned?.length) {
    lines.push('<p class="warn-title">Projects in cloud but missing from JSON</p><ul class="report-list">');
    a.orphaned.forEach(o => {
      lines.push(`<li><code>${esc(o.slug)}</code> — ${esc(o.title)} · ${o.mediaCount} media · ${esc(o.status)}</li>`);
    });
    lines.push('</ul>');
  }

  if (a.slugConflicts?.length) {
    lines.push('<p class="warn-title">Slug / media association warnings</p><ul class="report-list">');
    a.slugConflicts.forEach(w => lines.push(`<li>${esc(w.message)}</li>`));
    lines.push('</ul>');
  }

  if (a.timelineIssues?.length) {
    lines.push('<p class="warn-title">Timeline link issues</p><ul class="report-list">');
    a.timelineIssues.forEach(w => lines.push(`<li><code>${esc(w.slug)}</code>: ${esc(w.message)}</li>`));
    lines.push('</ul>');
  }

  if (a.mediaNotes?.length) {
    lines.push('<p class="muted small" style="margin-top:10px"><strong>Media notes</strong></p><ul class="report-list compact">');
    a.mediaNotes.forEach(n => lines.push(`<li><code>${esc(n.slug)}</code>: ${esc(n.message)}</li>`));
    lines.push('</ul>');
  }

  if (a.updated?.length) {
    lines.push('<p class="muted small" style="margin-top:10px"><strong>Text updates</strong></p><ul class="report-list compact">');
    a.updated.forEach(u => lines.push(`<li><code>${esc(u.slug)}</code> — ${esc(u.fieldsChanged?.join(', ') || 'changed')}${u.mediaCount ? ` · ${u.mediaCount} media kept` : ''}</li>`));
    lines.push('</ul>');
  }

  container.innerHTML = lines.join('');
  container.hidden = false;
}

async function fetchProjectMeta() {
  const { projects } = await api('/api/projects');
  let organizations = [];
  try {
    const orgRes = await api('/api/organizations');
    organizations = orgRes.organizations || [];
  } catch (_) {}
  let pack = {};
  try {
    const res = await api('/api/pack');
    pack = res.pack || {};
  } catch (_) {}
  return {
    categories: getAdminCategories(projects),
    tags: collectAllTags({ projects, timeline: pack.timeline, resume: pack.resume }),
    organizations,
  };
}

function renderOrganizationField(currentId, organizations) {
  const opts = [
    '<option value="">— Independent / no company —</option>',
    ...organizations.map(o =>
      `<option value="${esc(o.slug || o.id)}" ${(currentId === o.slug || currentId === o.id) ? 'selected' : ''}>${esc(o.title)}</option>`
    ),
  ].join('');
  return `<label>Company / organization
    <select name="organizationId">${opts}</select>
    <span class="muted small">Parent venture or employer for this project</span>
  </label>`;
}

function renderEntryKindField(kind, kindLabel) {
  const current = kind || 'project';
  const opts = DEFAULT_ENTRY_KINDS.map(k =>
    `<option value="${esc(k)}" ${current === k ? 'selected' : ''}>${esc(ENTRY_KIND_LABELS[k] || k)}</option>`
  ).join('');
  const showCustom = current === 'custom';
  return `
    <label>Entry type <span class="muted small">project, life moment, gallery, or your own label</span>
      <select name="entryKind" id="entry-kind-select">${opts}</select>
    </label>
    <label id="entry-kind-label-wrap" ${showCustom ? '' : 'hidden'}>Custom type label
      <input name="entryKindLabel" id="entry-kind-label" value="${esc(kindLabel || '')}" placeholder="e.g. Our wedding, Family trip">
      <span class="muted small">Shown on the site when type is Custom — or overrides the default label</span>
    </label>`;
}

function wireEntryKindField() {
  const sel = document.getElementById('entry-kind-select');
  const wrap = document.getElementById('entry-kind-label-wrap');
  if (!sel || !wrap) return;
  const sync = () => {
    wrap.hidden = sel.value !== 'custom';
  };
  sel.addEventListener('change', sync);
  sync();
}

function renderCategoryField(current, categories) {
  const isCustom = current && !categories.includes(current);
  const opts = categories.map(c => {
    const label = categoryLabel(c);
    const hint = DEFAULT_CATEGORIES.includes(c) ? ` (${c})` : '';
    return `<option value="${esc(c)}" ${(!isCustom && current === c) ? 'selected' : ''}>${esc(label)}${esc(hint)}</option>`;
  }).join('');
  return `
    <label>Category <span class="muted small">synced with portfolio Discover filters</span>
      <select name="category" id="category-select">
        ${opts}
        <option value="__custom__" ${isCustom ? 'selected' : ''}>+ New category…</option>
      </select>
      <input name="category-custom" id="category-custom" value="${isCustom ? esc(current) : ''}"
        placeholder="e.g. installation" class="category-custom-input" ${isCustom ? '' : 'hidden'}>
    </label>`;
}

function renderTagField(tagsStr, allTags) {
  const datalist = allTags.map(t => `<option value="${esc(t)}">`).join('');
  const chips = allTags.slice(0, 48).map(t =>
    `<button type="button" class="tag-chip" data-tag="${esc(t)}">${esc(t)}</button>`
  ).join('');
  return `
    <label>Tags <span class="muted small">comma-separated · click suggestions to add</span>
      <input name="tags" id="tags-input" value="${esc(tagsStr)}" list="tags-datalist" placeholder="LED, ESP32, Sculpture">
      <datalist id="tags-datalist">${datalist}</datalist>
      ${allTags.length ? `<div class="tag-suggestions" id="tag-suggestions">${chips}</div>` : ''}
    </label>`;
}

function wireCategoryField() {
  const sel = document.getElementById('category-select');
  const custom = document.getElementById('category-custom');
  if (!sel || !custom) return;
  sel.addEventListener('change', () => {
    const isCustom = sel.value === '__custom__';
    custom.hidden = !isCustom;
    if (isCustom) custom.focus();
  });
}

function wireTagSuggestions() {
  document.getElementById('tag-suggestions')?.addEventListener('click', e => {
    const chip = e.target.closest('[data-tag]');
    if (!chip) return;
    const input = document.getElementById('tags-input');
    if (!input) return;
    const tag = chip.dataset.tag;
    const parts = input.value.split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.includes(tag)) parts.push(tag);
    input.value = parts.join(', ');
  });
}

function resolveCategoryFromForm(fd) {
  const sel = fd.get('category');
  if (sel === '__custom__') {
    const custom = String(fd.get('category-custom') || '').trim();
    return slugifyCategory(custom) || 'engineering';
  }
  return sel || 'engineering';
}

function mediaUrl(m) {
  if (!m) return '';
  if (m.publicUrl) return m.publicUrl;
  if (m.src?.startsWith('http')) return m.src;
  if (MEDIA_BASE && m.src) return `${MEDIA_BASE.replace(/\/$/, '')}/${m.src.replace(/^\//, '')}`;
  return '';
}

async function api(path, opts = {}) {
  const url = `${API_BASE}${path}`;
  const token = getToken();
  let res;
  try {
    res = await fetch(url, {
      credentials: 'include',
      ...opts,
      headers: {
        ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
    });
  } catch {
    throw new Error(`Could not reach API at ${API_BASE}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText || `Request failed (${res.status})`);
  return data;
}

function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'companies';
  const parts = hash.split('/');
  if (parts[0] === 'data') return { view: 'data' };
  if (parts[0] === 'companies' && parts[1] === 'new') return { view: 'org-edit', id: null };
  if (parts[0] === 'companies' && parts[2] === 'edit') return { view: 'org-edit', id: parts[1] };
  if (parts[0] === 'companies') return { view: 'companies' };
  if (parts[0] === 'projects' && parts[1] === 'new') return { view: 'edit', id: null };
  if (parts[0] === 'projects' && parts[2] === 'edit') return { view: 'edit', id: parts[1] };
  return { view: 'list' };
}

function updateNavActive(view) {
  const navKey = view === 'data' ? 'data' : (view === 'companies' || view === 'org-edit') ? 'companies' : 'projects';
  document.querySelectorAll('#admin-nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.nav === navKey);
  });
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showLogin(err) {
  document.getElementById('view-login').hidden = false;
  document.getElementById('view-app').hidden = true;
  const el = document.getElementById('login-error');
  if (err) {
    el.textContent = err;
    el.hidden = false;
  } else {
    el.hidden = true;
    el.textContent = '';
  }
}

function showApp() {
  document.getElementById('view-login').hidden = true;
  document.getElementById('view-app').hidden = false;
}

async function renderData() {
  const main = document.getElementById('main');
  main.innerHTML = '<p class="muted">Loading…</p>';
  let pack = { version: 2, config: {}, projects: [] };
  try {
    const res = await api('/api/pack');
    if (res.pack) pack = res.pack;
  } catch (_) {}

  main.innerHTML = `
    <div class="glass data-panel workflow-panel">
      <h2>How this fits together</h2>
      <ol class="workflow-steps">
        <li><strong>AI Assistant</strong> — copy the prompt, describe updates in your AI tool, paste JSON back here.</li>
        <li><strong>Resume Data</strong> — batch import resume, timeline, skills, and project <em>text</em>. Projects match by <code>slug</code>; uploaded photos stay attached.</li>
        <li><strong>Projects</strong> — edit one project, upload gallery media, set category/tags, publish.</li>
        <li><strong>Live site</strong> — <a href="${esc(PORTFOLIO_URL)}" target="_blank" rel="noopener">portfolio</a> reads cloud data automatically.</li>
      </ol>
    </div>

    <div class="glass data-panel ai-panel">
      <h2>AI Update Assistant</h2>
      <p class="muted">Copy the prompt into ChatGPT, Claude, or any AI tool. Tell it what changed in your career or projects. Paste the model's <strong>JSON-only</strong> response below to update everything.</p>
      <label class="field-label">System prompt <span class="muted small">includes your current full package</span>
        <textarea id="ai-prompt" class="mono" rows="14" readonly></textarea>
      </label>
      <div class="toolbar">
        <button type="button" class="btn primary" id="btn-copy-prompt">Copy prompt</button>
      </div>
      <label class="field-label" style="margin-top:14px">Paste AI JSON output here
        <textarea id="ai-output" class="mono" rows="12" placeholder='{"version":2,"resume":{...},"timeline":[...],"projects":[...]}'></textarea>
      </label>
      <div class="toolbar">
        <button type="button" class="btn primary" id="btn-ai-preview">Check AI output</button>
        <button type="button" class="btn primary" id="btn-ai-apply">Apply AI output to cloud</button>
      </div>
      <div id="ai-report" class="import-report" hidden></div>
      <p id="ai-status" class="status"></p>
    </div>

    <div class="glass data-panel">
      <h2>Resume Data</h2>
      <p class="muted">Import a full package. Use <strong>Check for issues</strong> before saving to see slug mismatches, orphaned projects, and media association notes.</p>
      <textarea id="pack-json" rows="14" placeholder='{"version":2,"resume":{...},"timeline":[...],"projects":[...]}'></textarea>
      <div class="import-options">
        <label class="orphan-label">Projects in cloud but not in JSON
          <select id="orphan-action">
            <option value="keep">Keep as-is (default)</option>
            <option value="draft">Unpublish (move to draft)</option>
            <option value="delete">Delete (removes media too)</option>
          </select>
        </label>
      </div>
      <div class="toolbar">
        <button type="button" class="btn primary" id="btn-pack-preview">Check for issues</button>
        <button type="button" class="btn primary" id="btn-pack-apply">Apply &amp; Save to Cloud</button>
        <button type="button" class="btn" id="btn-pack-file">Import File…</button>
        <input type="file" id="pack-file-input" accept=".json" hidden>
        <button type="button" class="btn" id="btn-pack-export">Export JSON</button>
        <button type="button" class="btn" id="btn-pack-load">Reload from Cloud</button>
      </div>
      <div id="pack-report" class="import-report" hidden></div>
      <p id="pack-status" class="status"></p>
    </div>`;

  const area = document.getElementById('pack-json');
  area.value = JSON.stringify(pack, null, 2);

  const aiPrompt = document.getElementById('ai-prompt');
  if (aiPrompt) aiPrompt.value = buildResumeAiPrompt(pack);

  const setAiStatus = (msg, ok) => {
    const st = document.getElementById('ai-status');
    if (!st) return;
    st.textContent = msg;
    st.className = ok ? 'status ok' : 'status err';
  };

  document.getElementById('btn-copy-prompt')?.addEventListener('click', async () => {
    const text = aiPrompt?.value || '';
    try {
      await navigator.clipboard.writeText(text);
      setAiStatus('Prompt copied — paste it into your AI tool, then describe your updates.', true);
    } catch {
      aiPrompt?.select();
      setAiStatus('Select the prompt and copy manually (⌘C).', false);
    }
  });

  const applyAiJson = async (previewOnly) => {
    const raw = document.getElementById('ai-output')?.value?.trim();
    if (!raw) { setAiStatus('Paste AI JSON output first.', false); return; }
    try {
      const parsed = JSON.parse(raw);
      const orphanAction = document.getElementById('orphan-action')?.value || 'keep';
      if (previewOnly) {
        setAiStatus('Checking…', true);
        const res = await api('/api/pack/preview', { method: 'POST', body: JSON.stringify(parsed) });
        renderImportReport(document.getElementById('ai-report'), res);
        area.value = JSON.stringify(parsed, null, 2);
        aiPrompt.value = buildResumeAiPrompt(parsed);
        const w = res.analysis?.summary?.warnings || 0;
        const o = res.analysis?.summary?.orphaned || 0;
        setAiStatus(w || o ? `Issues found: ${w} warning(s), ${o} orphaned.` : 'AI output looks good — click Apply when ready.', !w && !o);
        return;
      }
      if (orphanAction === 'delete') {
        const preview = await api('/api/pack/preview', { method: 'POST', body: JSON.stringify(parsed) });
        const n = preview.analysis?.orphaned?.length || 0;
        if (n && !confirm(`Delete ${n} project(s) not in JSON (and all their media)?`)) return;
      }
      setAiStatus('Saving…', true);
      const res = await api('/api/pack/import', { method: 'POST', body: JSON.stringify({ ...parsed, orphanAction }) });
      renderImportReport(document.getElementById('ai-report'), res);
      area.value = JSON.stringify(parsed, null, 2);
      aiPrompt.value = buildResumeAiPrompt(parsed);
      setAiStatus(`Applied. Projects: ${res.created || 0} new, ${res.updated || 0} updated.`, true);
      const packReport = document.getElementById('pack-report');
      if (packReport) packReport.hidden = true;
    } catch (err) {
      setAiStatus(err.message, false);
    }
  };

  document.getElementById('btn-ai-preview')?.addEventListener('click', () => applyAiJson(true));
  document.getElementById('btn-ai-apply')?.addEventListener('click', () => applyAiJson(false));

  const setStatus = (msg, ok) => {
    const st = document.getElementById('pack-status');
    st.textContent = msg;
    st.className = ok ? 'status ok' : 'status err';
  };

  document.getElementById('btn-pack-preview')?.addEventListener('click', async () => {
    const raw = area.value.trim();
    if (!raw) { setStatus('Paste JSON first.', false); return; }
    try {
      const parsed = JSON.parse(raw);
      setStatus('Checking…', true);
      const res = await api('/api/pack/preview', { method: 'POST', body: JSON.stringify(parsed) });
      renderImportReport(document.getElementById('pack-report'), res);
      const w = res.analysis?.summary?.warnings || 0;
      const o = res.analysis?.summary?.orphaned || 0;
      setStatus(w || o ? `Found ${w} warning(s) and ${o} orphaned project(s). Review before applying.` : 'No issues found — safe to apply.', !w && !o);
    } catch (err) {
      setStatus(err.message, false);
    }
  });

  document.getElementById('btn-pack-apply')?.addEventListener('click', async () => {
    const raw = area.value.trim();
    if (!raw) { setStatus('Paste JSON first.', false); return; }
    try {
      const parsed = JSON.parse(raw);
      const orphanAction = document.getElementById('orphan-action')?.value || 'keep';
      if (orphanAction === 'delete') {
        const preview = await api('/api/pack/preview', { method: 'POST', body: JSON.stringify(parsed) });
        const n = preview.analysis?.orphaned?.length || 0;
        if (n && !confirm(`Delete ${n} project(s) not in JSON (and all their media)?`)) return;
      }
      setStatus('Saving…', true);
      const res = await api('/api/pack/import', { method: 'POST', body: JSON.stringify({ ...parsed, orphanAction }) });
      renderImportReport(document.getElementById('pack-report'), res);
      const orphanMsg = res.orphans?.deleted ? ` · ${res.orphans.deleted} deleted` : res.orphans?.drafted ? ` · ${res.orphans.drafted} unpublished` : '';
      setStatus(`Saved. Projects: ${res.created || 0} new, ${res.updated || 0} updated${orphanMsg}.`, true);
    } catch (err) {
      setStatus(err.message, false);
    }
  });

  document.getElementById('btn-pack-load')?.addEventListener('click', async () => {
    try {
      const res = await api('/api/pack');
      area.value = JSON.stringify(res.pack || {}, null, 2);
      if (aiPrompt) aiPrompt.value = buildResumeAiPrompt(res.pack || {});
      setStatus('Reloaded from cloud.', true);
    } catch (err) {
      setStatus(err.message, false);
    }
  });

  document.getElementById('btn-pack-export')?.addEventListener('click', () => {
    try {
      const parsed = JSON.parse(area.value);
      const blob = new Blob([JSON.stringify(parsed, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'resume_pack.json';
      a.click();
      URL.revokeObjectURL(url);
      setStatus('Exported.', true);
    } catch (err) {
      setStatus('Invalid JSON in editor: ' + err.message, false);
    }
  });

  document.getElementById('btn-pack-file')?.addEventListener('click', () => {
    document.getElementById('pack-file-input')?.click();
  });
  document.getElementById('pack-file-input')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      area.value = ev.target.result;
      document.getElementById('pack-report').hidden = true;
    };
    reader.readAsText(file);
    e.target.value = '';
  });
}

async function renderOrgList() {
  const main = document.getElementById('main');
  main.innerHTML = '<p class="muted">Loading…</p>';
  const { organizations } = await api('/api/organizations');
  main.innerHTML = `
    <div class="toolbar">
      <a href="#/companies/new" class="btn primary">+ New company</a>
      <a href="#/projects" class="btn">All projects</a>
    </div>
    <p class="muted small" style="margin-bottom:16px">Companies and ventures are parents — add individual products and builds as <strong>Projects</strong> linked to a company.</p>
    <div class="project-list">
      ${organizations.length ? organizations.map(o => `
        <div class="project-row glass">
          <div>
            <h3>${esc(o.title)}</h3>
            <p class="muted small">${esc(o.slug)} · ${esc(categoryLabel(o.category))}</p>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <span class="badge ${o.status === 'published' ? 'published' : ''}">${esc(o.status)}</span>
            <a href="#/companies/${o.id}/edit" class="btn">Edit</a>
          </div>
        </div>
      `).join('') : '<p class="muted">No companies yet. Create one for Space Cadets Lighting, Gorilla Machines, etc.</p>'}
    </div>`;
}

async function renderOrgEdit(id) {
  const main = document.getElementById('main');
  main.innerHTML = '<p class="muted">Loading…</p>';
  const meta = await fetchProjectMeta();
  let org = {
    title: '', slug: '', subtitle: '', description: '', tags: [], website: '',
    date: '', category: 'venture', links: [], status: 'draft', featured: false, sortOrder: 0, timelineRef: '',
  };
  if (id) {
    const res = await api(`/api/organizations/${id}`);
    org = res.organization;
  }
  const tagsStr = (org.tags || []).join(', ');
  main.innerHTML = `
    <p><a href="#/companies">← All companies</a></p>
    <form id="org-form" class="form-grid glass" style="padding:20px;margin-top:12px">
      <label>Title<input name="title" value="${esc(org.title)}" required></label>
      <label>Slug <span class="muted small">stable key — avoid changing after linking projects</span>
        <input name="slug" value="${esc(org.slug)}" placeholder="space-cadets-lighting"></label>
      <label>Subtitle<input name="subtitle" value="${esc(org.subtitle || '')}"></label>
      <label>Description<textarea name="description">${esc(org.description || '')}</textarea></label>
      <label>Website<input name="website" value="${esc(org.website || '')}" placeholder="https://…"></label>
      ${renderTagField(tagsStr, meta.tags)}
      <label>Founded / start date (YYYY-MM)<input name="date" value="${esc(org.date || '')}"></label>
      ${renderCategoryField(org.category || 'venture', meta.categories)}
      <label>Timeline ref <span class="muted small">matches timeline entry id</span>
        <input name="timelineRef" value="${esc(org.timelineRef || '')}" placeholder="2020-03-space-cadets"></label>
      <label>Status
        <select name="status">
          <option value="draft" ${org.status === 'draft' ? 'selected' : ''}>draft</option>
          <option value="published" ${org.status === 'published' ? 'selected' : ''}>published</option>
        </select>
      </label>
      <label><input type="checkbox" name="featured" ${org.featured ? 'checked' : ''}> Featured on Companies section</label>
      <label>Sort order<input name="sortOrder" type="number" value="${org.sortOrder ?? 0}"></label>
      <div class="form-actions">
        <button type="submit" class="btn primary">Save company</button>
        ${id ? '<button type="button" id="btn-org-delete" class="btn">Delete</button>' : ''}
      </div>
      <p id="org-save-status" class="status"></p>
    </form>`;

  wireCategoryField();
  wireTagSuggestions();

  document.getElementById('org-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      title: fd.get('title'),
      slug: fd.get('slug'),
      subtitle: fd.get('subtitle'),
      description: fd.get('description'),
      website: fd.get('website'),
      tags: String(fd.get('tags')).split(',').map(s => s.trim()).filter(Boolean),
      date: fd.get('date'),
      category: resolveCategoryFromForm(fd),
      timelineRef: fd.get('timelineRef') || null,
      status: fd.get('status'),
      featured: !!fd.get('featured'),
      sortOrder: Number(fd.get('sortOrder')) || 0,
    };
    const status = document.getElementById('org-save-status');
    try {
      if (id) {
        await api(`/api/organizations/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        status.textContent = 'Saved.';
      } else {
        const res = await api('/api/organizations', { method: 'POST', body: JSON.stringify(body) });
        location.hash = `#/companies/${res.organization.id}/edit`;
      }
    } catch (err) {
      status.textContent = err.message;
    }
  });

  if (id) {
    document.getElementById('btn-org-delete')?.addEventListener('click', async () => {
      if (!confirm('Delete this company? Projects must be reassigned first.')) return;
      try {
        await api(`/api/organizations/${id}`, { method: 'DELETE' });
        location.hash = '#/companies';
      } catch (err) {
        document.getElementById('org-save-status').textContent = err.message;
      }
    });
  }
}

async function renderList() {
  const main = document.getElementById('main');
  main.innerHTML = '<p class="muted">Loading…</p>';
  const { projects } = await api('/api/projects');
  main.innerHTML = `
    <div class="toolbar">
      <a href="#/projects/new" class="btn primary">+ New entry</a>
      <a href="#/data" class="btn">Import resume JSON</a>
    </div>
    <p class="muted small" style="margin-bottom:16px">Work projects, life moments, photo galleries — upload photos per entry via <strong>Edit</strong>.</p>
    <div class="project-list">
      ${projects.length ? projects.map(p => `
        <div class="project-row glass">
          <div>
            <h3>${esc(p.title)}</h3>
            <p class="muted small">${esc(p.slug)} · ${esc(entryKindLabel(p.entryKind, p.entryKindLabel))}${p.organizationId ? ` · ${esc(p.organizationId)}` : ''}${p.featuredDiscover ? ' · Discover' : ''} · ${p.media?.length || 0} media</p>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <span class="badge ${p.status === 'published' ? 'published' : ''}">${esc(p.status)}</span>
            <a href="#/projects/${p.id}/edit" class="btn">Edit</a>
          </div>
        </div>
      `).join('') : '<p class="muted">No projects yet. Create one to get started.</p>'}
    </div>`;

  /* list only — import is on Resume Data tab */
}

async function renderEdit(id) {
  const main = document.getElementById('main');
  main.innerHTML = '<p class="muted">Loading…</p>';
  const meta = await fetchProjectMeta();
  let project = {
    title: '', slug: '', subtitle: '', description: '', tags: [], role: '', tools: [],
    year: new Date().getFullYear(), date: '', category: 'engineering', links: [],
    status: 'draft', featured: false, featuredDiscover: false, sortOrder: 0, timelineRef: '', organizationId: '',
    entryKind: 'project', entryKindLabel: '', media: [],
  };
  if (id) {
    const res = await api(`/api/projects/${id}`);
    project = res.project;
  }

  const tagsStr = (project.tags || []).join(', ');
  const toolsStr = (project.tools || []).join(', ');

  main.innerHTML = `
    <p><a href="#/projects">← All projects</a></p>
    <form id="project-form" class="form-grid glass" style="padding:20px;margin-top:12px">
      <label>Title<input name="title" value="${esc(project.title)}" required></label>
      <label>Slug <span class="muted small">stable key for photos — avoid changing after upload</span>
        <input name="slug" value="${esc(project.slug)}" placeholder="auto-from-title"></label>
      <label>Subtitle<input name="subtitle" value="${esc(project.subtitle || '')}"></label>
      ${renderEntryKindField(project.entryKind, project.entryKindLabel)}
      <label>Description<textarea name="description">${esc(project.description || project.details || '')}</textarea></label>
      ${renderTagField(tagsStr, meta.tags)}
      <label>Role<input name="role" value="${esc(project.role || '')}"></label>
      <label>Tools (comma-separated)<input name="tools" value="${esc(toolsStr)}"></label>
      <label>Year<input name="year" type="number" value="${project.year || ''}"></label>
      <label>Date (YYYY-MM)<input name="date" value="${esc(project.date || '')}"></label>
      ${renderCategoryField(project.category || 'engineering', meta.categories)}
      ${renderOrganizationField(project.organizationId, meta.organizations)}
      <label>Timeline ref <span class="muted small">matches timeline entry id</span>
        <input name="timelineRef" value="${esc(project.timelineRef || '')}" placeholder="2017-03-gorilla-machines"></label>
      <label>Status
        <select name="status">
          <option value="draft" ${project.status === 'draft' ? 'selected' : ''}>draft</option>
          <option value="published" ${project.status === 'published' ? 'selected' : ''}>published</option>
        </select>
      </label>
      <label><input type="checkbox" name="featuredDiscover" ${project.featuredDiscover ? 'checked' : ''}> Featured on Discover</label>
      <label><input type="checkbox" name="featured" ${project.featured ? 'checked' : ''}> Featured in Projects grid</label>
      <label>Sort order<input name="sortOrder" type="number" value="${project.sortOrder ?? 0}"></label>
      <div class="form-actions">
        <button type="submit" class="btn primary">Save project</button>
        ${id ? '<button type="button" id="btn-delete" class="btn">Delete</button>' : ''}
      </div>
      <p id="save-status" class="status"></p>
    </form>

    ${id ? `
      <section style="margin-top:28px">
        <h2>Media</h2>
        <div class="upload-zone">
          <p class="muted">Upload images, video, PDF, or GLB</p>
          <input type="file" id="file-input" accept="image/*,video/mp4,video/webm,.pdf,.glb,.gltf">
          <label style="margin-top:10px;display:block">Slot
            <select id="upload-slot">
              <option value="gallery">Gallery image</option>
              <option value="hero">Hero image</option>
              <option value="video">Video</option>
              <option value="pdf">PDF</option>
              <option value="model">3D model (GLB)</option>
            </select>
          </label>
          <p id="upload-status" class="status"></p>
        </div>
        <div class="media-grid" id="media-grid"></div>
      </section>
    ` : '<p class="muted" style="margin-top:16px">Save the project first, then upload media.</p>'}
  `;

  wireCategoryField();
  wireTagSuggestions();
  wireEntryKindField();

  document.getElementById('project-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      title: fd.get('title'),
      slug: fd.get('slug'),
      subtitle: fd.get('subtitle'),
      description: fd.get('description'),
      tags: String(fd.get('tags')).split(',').map(s => s.trim()).filter(Boolean),
      role: fd.get('role'),
      tools: String(fd.get('tools')).split(',').map(s => s.trim()).filter(Boolean),
      year: Number(fd.get('year')) || null,
      date: fd.get('date'),
      category: resolveCategoryFromForm(fd),
      timelineRef: fd.get('timelineRef') || null,
      organizationId: fd.get('organizationId') || null,
      entryKind: fd.get('entryKind') || 'project',
      entryKindLabel: fd.get('entryKindLabel') || '',
      status: fd.get('status'),
      featured: !!fd.get('featured'),
      featuredDiscover: !!fd.get('featuredDiscover'),
      sortOrder: Number(fd.get('sortOrder')) || 0,
    };
    const status = document.getElementById('save-status');
    try {
      if (id) {
        await api(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        status.textContent = 'Saved.';
      } else {
        const res = await api('/api/projects', { method: 'POST', body: JSON.stringify(body) });
        location.hash = `#/projects/${res.project.id}/edit`;
        return;
      }
    } catch (err) {
      status.textContent = err.message;
    }
  });

  if (id) {
    await refreshMediaGrid(id);

    document.getElementById('btn-delete')?.addEventListener('click', async () => {
      if (!confirm('Delete this project and all its media?')) return;
      await api(`/api/projects/${id}`, { method: 'DELETE' });
      location.hash = '#/projects';
    });

    document.getElementById('file-input')?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const slot = document.getElementById('upload-slot').value;
      const st = document.getElementById('upload-status');
      st.textContent = 'Uploading…';
      const form = new FormData();
      form.append('file', file);
      form.append('projectId', id);
      form.append('slot', slot);
      try {
        await api('/api/media/upload', { method: 'POST', body: form });
        st.textContent = 'Uploaded.';
        e.target.value = '';
        await refreshMediaGrid(id);
      } catch (err) {
        st.textContent = err.message;
      }
    });
  }
}

async function refreshMediaGrid(projectId) {
  const grid = document.getElementById('media-grid');
  if (!grid) return;
  const res = await api(`/api/projects/${projectId}`);
  const media = res.project.media || [];
  grid.innerHTML = media.length ? media.map(m => {
    const url = mediaUrl(m);
    let preview = '<div style="aspect-ratio:4/3;background:rgba(255,255,255,0.05)"></div>';
    if (m.type === 'image' && url) preview = `<img src="${esc(url)}" alt="">`;
    else if (m.type === 'video' && url) preview = `<video src="${esc(url)}" muted></video>`;
    else if (m.type === 'link') preview = `<div class="meta" style="padding:20px"><a href="${esc(m.url || url)}" target="_blank">PDF / link</a></div>`;
    return `<div class="media-card">
      ${preview}
      <div class="meta">${esc(m.caption || m.type || 'media')}
        ${m.id ? `<button type="button" class="btn del-media" data-id="${esc(m.id)}" style="margin-top:4px;font-size:10px">Delete</button>` : ''}
      </div>
    </div>`;
  }).join('') : '<p class="muted">No media yet.</p>';

  grid.querySelectorAll('.del-media').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this file?')) return;
      await api(`/api/media/${btn.dataset.id}`, { method: 'DELETE' });
      await refreshMediaGrid(projectId);
    });
  });
}

async function navigate() {
  const { view, id } = route();
  updateNavActive(view);
  try {
    if (view === 'data') await renderData();
    else if (view === 'companies') await renderOrgList();
    else if (view === 'org-edit') await renderOrgEdit(id);
    else if (view === 'list') await renderList();
    else await renderEdit(id);
  } catch (err) {
    if (err.message === 'Unauthorized' || err.message.includes('401')) {
      setToken('');
      showLogin('Session expired. Sign in again.');
      return;
    }
    document.getElementById('main').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

async function init() {
  await loadConfig();
  wireSiteLinks();

  function bindLoginForm() {
    const form = document.getElementById('login-form');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const password = document.getElementById('login-password').value;
      const submitBtn = e.target.querySelector('button[type="submit"]');
      const errEl = document.getElementById('login-error');
      errEl.hidden = true;
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Signing in…'; }
      try {
        if (!API_BASE) throw new Error('API not configured. Check admin/config.json.');
        const res = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: password.trim() }) });
        if (!res.token) throw new Error('Login succeeded but no session token was returned. Redeploy the Worker.');
        setToken(res.token);
        const me = await api('/api/auth/me');
        if (!me.authed) {
          throw new Error('Session could not be verified. Try: cd worker && npx wrangler secret put SESSION_SECRET');
        }
        if (me.mediaBaseUrl) MEDIA_BASE = me.mediaBaseUrl;
        if (me.portfolioUrl) wireSiteLinks(me.portfolioUrl);
        showApp();
        await navigate();
      } catch (err) {
        setToken('');
        const msg = err.message || 'Login failed';
        if (msg.includes('Invalid password')) {
          showLogin('Invalid password. If you forgot it, reset with: wrangler secret put ADMIN_PASSWORD');
        } else {
          showLogin(msg);
        }
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Sign in'; }
      }
    });
  }

  bindLoginForm();

  try {
    const me = await api('/api/auth/me');
    if (me.portfolioUrl) wireSiteLinks(me.portfolioUrl);
    if (me.mediaBaseUrl) MEDIA_BASE = me.mediaBaseUrl;
  } catch (_) {}

  if (!API_BASE) {
    showLogin('Set apiBaseUrl in admin/config.json after deploying the Worker.');
    return;
  }

  try {
    const status = await fetch(`${API_BASE}/api/auth/status`).then(r => r.json());
    if (!status.loginConfigured) {
      showLogin('Server admin password is not configured. Run: wrangler secret put ADMIN_PASSWORD');
      return;
    }
  } catch (_) {}

  const canonical = document.getElementById('admin-canonical-link');
  if (canonical && !window.location.hostname.endsWith('.workers.dev')) {
    canonical.href = 'https://isaac-portfolio-api.spacecadets.workers.dev/';
    canonical.textContent = 'isaac-portfolio-api.spacecadets.workers.dev';
  } else if (canonical) {
    canonical.parentElement.hidden = true;
  }

  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setToken('');
    showLogin();
  });

  window.addEventListener('hashchange', () => { if (!document.getElementById('view-app').hidden) navigate(); });

  try {
    const me = await api('/api/auth/me');
    if (me.mediaBaseUrl) MEDIA_BASE = me.mediaBaseUrl;
    if (me.portfolioUrl) wireSiteLinks(me.portfolioUrl);
    if (me.authed) {
      showApp();
      await navigate();
    } else showLogin();
  } catch {
    showLogin('');
  }
}

init().catch(err => showLogin(err?.message || 'Admin failed to start.'));
