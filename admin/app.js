let API_BASE = '';
let MEDIA_BASE = '';
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
    }
  } catch (_) {}
  if (!API_BASE && window.location.hostname === 'localhost') {
    API_BASE = 'http://localhost:8787';
  }
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
  const res = await fetch(url, {
    credentials: 'include',
    ...opts,
    headers: {
      ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText || `Request failed (${res.status})`);
  return data;
}

function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'projects';
  const parts = hash.split('/');
  if (parts[0] === 'projects' && parts[1] === 'new') return { view: 'edit', id: null };
  if (parts[0] === 'projects' && parts[2] === 'edit') return { view: 'edit', id: parts[1] };
  return { view: 'list' };
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showLogin(err) {
  document.getElementById('view-login').hidden = false;
  document.getElementById('view-app').hidden = true;
  const el = document.getElementById('login-error');
  if (err) { el.textContent = err; el.hidden = false; } else el.hidden = true;
}

function showApp() {
  document.getElementById('view-login').hidden = true;
  document.getElementById('view-app').hidden = false;
}

async function renderList() {
  const main = document.getElementById('main');
  main.innerHTML = '<p class="muted">Loading…</p>';
  const { projects } = await api('/api/projects');
  main.innerHTML = `
    <div class="toolbar">
      <a href="#/projects/new" class="btn primary">+ New project</a>
    </div>
    <div class="project-list">
      ${projects.length ? projects.map(p => `
        <div class="project-row glass">
          <div>
            <h3>${esc(p.title)}</h3>
            <p class="muted small">${esc(p.slug)} · ${p.media?.length || 0} media</p>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <span class="badge ${p.status === 'published' ? 'published' : ''}">${esc(p.status)}</span>
            <a href="#/projects/${p.id}/edit" class="btn">Edit</a>
          </div>
        </div>
      `).join('') : '<p class="muted">No projects yet. Create one to get started.</p>'}
    </div>`;
}

async function renderEdit(id) {
  const main = document.getElementById('main');
  main.innerHTML = '<p class="muted">Loading…</p>';
  let project = {
    title: '', slug: '', subtitle: '', description: '', tags: [], role: '', tools: [],
    year: new Date().getFullYear(), date: '', category: 'engineering', links: [],
    status: 'draft', featured: false, sortOrder: 0, timelineRef: '', media: [],
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
      <label>Slug<input name="slug" value="${esc(project.slug)}" placeholder="auto-from-title"></label>
      <label>Subtitle<input name="subtitle" value="${esc(project.subtitle || '')}"></label>
      <label>Description<textarea name="description">${esc(project.description || project.details || '')}</textarea></label>
      <label>Tags (comma-separated)<input name="tags" value="${esc(tagsStr)}"></label>
      <label>Role<input name="role" value="${esc(project.role || '')}"></label>
      <label>Tools (comma-separated)<input name="tools" value="${esc(toolsStr)}"></label>
      <label>Year<input name="year" type="number" value="${project.year || ''}"></label>
      <label>Date (YYYY-MM)<input name="date" value="${esc(project.date || '')}"></label>
      <label>Category
        <select name="category">
          ${['venture','engineering','community','art'].map(c =>
            `<option value="${c}" ${project.category === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </label>
      <label>Status
        <select name="status">
          <option value="draft" ${project.status === 'draft' ? 'selected' : ''}>draft</option>
          <option value="published" ${project.status === 'published' ? 'selected' : ''}>published</option>
        </select>
      </label>
      <label><input type="checkbox" name="featured" ${project.featured ? 'checked' : ''}> Featured on portfolio</label>
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
      category: fd.get('category'),
      status: fd.get('status'),
      featured: !!fd.get('featured'),
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
  try {
    if (view === 'list') await renderList();
    else await renderEdit(id);
  } catch (err) {
    if (err.message === 'Unauthorized' || err.message.includes('401')) {
      showLogin();
      return;
    }
    document.getElementById('main').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

async function init() {
  await loadConfig();
  if (!API_BASE) {
    showLogin('Set apiBaseUrl in admin/config.json after deploying the Worker.');
    return;
  }

  document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const password = document.getElementById('login-password').value;
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const errEl = document.getElementById('login-error');
    errEl.hidden = true;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Signing in…'; }
    try {
      const res = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
      if (!res.token) throw new Error('Login succeeded but no session token was returned. Redeploy the Worker.');
      setToken(res.token);
      const me = await api('/api/auth/me');
      if (!me.authed) throw new Error('Session could not be established. Try again.');
      if (me.mediaBaseUrl) MEDIA_BASE = me.mediaBaseUrl;
      showApp();
      await navigate();
    } catch (err) {
      setToken('');
      showLogin(err.message);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Sign in'; }
    }
  });

  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setToken('');
    showLogin();
  });

  window.addEventListener('hashchange', () => { if (!document.getElementById('view-app').hidden) navigate(); });

  try {
    const me = await api('/api/auth/me');
    if (me.mediaBaseUrl) MEDIA_BASE = me.mediaBaseUrl;
    if (me.authed) {
      showApp();
      await navigate();
    } else showLogin();
  } catch {
    showLogin(API_BASE ? '' : 'API not configured.');
  }
}

init();
