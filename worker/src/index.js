/**
 * Portfolio CMS API — auth, projects, media upload to R2.
 * Secrets: ADMIN_PASSWORD, SESSION_SECRET (wrangler secret put)
 */

const SESSION_COOKIE = 'portfolio_session';
const SESSION_DAYS = 7;

const MIME_LIMITS = {
  image: 15 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  pdf: 25 * 1024 * 1024,
  model: 50 * 1024 * 1024,
};

const ALLOWED_MIME = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  video: ['video/mp4', 'video/webm'],
  pdf: ['application/pdf'],
  model: ['model/gltf-binary', 'model/glb', 'application/octet-stream'],
};

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
  const ok = origin && allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed[0] || '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

function uuid() {
  return crypto.randomUUID();
}

function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function now() {
  return new Date().toISOString();
}

async function signSession(env) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const payload = new TextEncoder().encode(String(exp));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.SESSION_SECRET || 'change-me'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, payload);
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${exp}.${sigB64}`;
}

async function verifySession(cookie, env) {
  if (!cookie || !env.SESSION_SECRET) return false;
  const [expStr, sigB64] = cookie.split('.');
  if (!expStr || !sigB64) return false;
  if (Date.now() > Number(expStr)) return false;
  const payload = new TextEncoder().encode(expStr);
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  const sig = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0));
  return crypto.subtle.verify('HMAC', key, sig, payload);
}

function sessionCookie(value, maxAge) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`;
}

async function sessionTokenFromRequest(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (bearer) return bearer;
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match?.[1] || '';
}

async function requireAuth(request, env) {
  const token = await sessionTokenFromRequest(request, env);
  if (!token || !(await verifySession(token, env))) return null;
  return true;
}

function fileTypeFromMime(mime) {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.includes('gltf') || mime.includes('glb') || mime === 'application/octet-stream') return 'model';
  return null;
}

function slotFolder(slot) {
  if (slot === 'hero') return 'hero';
  if (slot === 'video') return 'video';
  if (slot === 'model') return 'models';
  if (slot === 'pdf' || slot === 'attachment') return 'files';
  return 'gallery';
}

function extFromMime(mime, name) {
  const fromName = (name || '').split('.').pop();
  if (fromName && fromName.length <= 5) return fromName.toLowerCase();
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'application/pdf': 'pdf' };
  return map[mime] || 'bin';
}

function parseJsonField(val, fallback) {
  try { return JSON.parse(val || ''); } catch { return fallback; }
}

async function rowToProject(row, mediaRows) {
  const media = (mediaRows || []).filter(m => m.project_id === row.id).sort((a, b) => a.sort_order - b.sort_order);
  const hero = media.find(m => m.id === row.hero_media_id) || media.find(m => m.slot === 'hero');
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    summary: row.subtitle,
    details: row.description,
    description: row.description,
    tags: parseJsonField(row.tags, []),
    role: row.role,
    tools: parseJsonField(row.tools, []),
    year: row.year,
    date: row.date,
    category: row.category,
    links: parseJsonField(row.links, []),
    status: row.status,
    featured: !!row.featured,
    sortOrder: row.sort_order,
    timelineRef: row.timeline_ref,
    hero: hero ? mediaAssetToLegacy(hero) : null,
    media: media.map(mediaAssetToLegacy),
    updatedAt: row.updated_at,
  };
}

function mediaAssetToLegacy(m) {
  if (m.file_type === 'link') return { type: 'link', url: m.public_url, label: m.caption };
  const rel = m.r2_key.replace(/^portfolio\/projects\/[^/]+\//, '').replace(/^(hero|gallery|video|models|files)\//, '');
  const src = m.r2_key.replace(/^portfolio\//, '');
  const item = {
    id: m.id,
    type: m.file_type === 'video' ? 'video' : m.file_type === 'pdf' ? 'link' : 'image',
    src,
    publicUrl: m.public_url,
    caption: m.caption || m.alt_text,
    tags: [],
  };
  if (m.file_type === 'video') {
    const poster = m.poster_url;
    if (poster) item.poster = poster;
  }
  if (m.file_type === 'pdf') {
    item.type = 'link';
    item.url = m.public_url;
    item.label = m.caption || 'PDF';
    delete item.src;
  }
  return item;
}

async function getProjectMedia(db, projectId) {
  const { results } = await db.prepare(
    'SELECT * FROM media_assets WHERE project_id = ? ORDER BY sort_order ASC'
  ).bind(projectId).all();
  return results || [];
}

async function handleLogin(request, env, cors) {
  const { password } = await request.json();
  if (!password || password !== env.ADMIN_PASSWORD) {
    return json({ error: 'Invalid password' }, 401, cors);
  }
  const token = await signSession(env);
  return json({ ok: true, token }, 200, {
    ...cors,
    'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400),
  });
}

async function handleLogout(cors) {
  return json({ ok: true }, 200, {
    ...cors,
    'Set-Cookie': sessionCookie('', 0),
  });
}

async function handleMe(request, env, cors) {
  const authed = await requireAuth(request, env);
  return json({
    authed: !!authed,
    mediaBaseUrl: env.R2_PUBLIC_BASE_URL || '',
  }, 200, cors);
}

async function listProjects(db, publishedOnly) {
  const q = publishedOnly
    ? "SELECT * FROM projects WHERE status = 'published' ORDER BY sort_order ASC, updated_at DESC"
    : 'SELECT * FROM projects ORDER BY sort_order ASC, updated_at DESC';
  const { results: projects } = await db.prepare(q).all();
  const { results: allMedia } = await db.prepare('SELECT * FROM media_assets ORDER BY sort_order ASC').all();
  return Promise.all((projects || []).map(p => rowToProject(p, allMedia)));
}

async function getProject(db, id) {
  const row = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
  if (!row) return null;
  const media = await getProjectMedia(db, id);
  return rowToProject(row, media);
}

async function handlePublicProjects(env, cors) {
  const projects = await listProjects(env.DB, true);
  return json({
    version: 2,
    config: { mediaBaseUrl: env.R2_PUBLIC_BASE_URL || '' },
    projects,
  }, 200, cors);
}

async function handleAdminProjects(request, env, cors) {
  const projects = await listProjects(env.DB, false);
  return json({ projects }, 200, cors);
}

async function handleCreateProject(request, env, cors) {
  const body = await request.json();
  const id = uuid();
  const slug = slugify(body.slug || body.title) || id.slice(0, 8);
  const ts = now();
  await env.DB.prepare(`
    INSERT INTO projects (id, slug, title, subtitle, description, tags, role, tools, year, date,
      category, links, status, featured, sort_order, timeline_ref, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, slug, body.title || 'Untitled', body.subtitle || '', body.description || '',
    JSON.stringify(body.tags || []), body.role || '', JSON.stringify(body.tools || []),
    body.year || null, body.date || '', body.category || 'engineering',
    JSON.stringify(body.links || []), body.status || 'draft', body.featured ? 1 : 0,
    body.sortOrder ?? 0, body.timelineRef || null, ts, ts
  ).run();
  const project = await getProject(env.DB, id);
  return json({ project }, 201, cors);
}

async function handleUpdateProject(request, env, cors, id) {
  const body = await request.json();
  const existing = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first();
  if (!existing) return json({ error: 'Not found' }, 404, cors);
  const ts = now();
  await env.DB.prepare(`
    UPDATE projects SET slug=?, title=?, subtitle=?, description=?, tags=?, role=?, tools=?,
      year=?, date=?, category=?, links=?, status=?, featured=?, sort_order=?, timeline_ref=?,
      hero_media_id=?, updated_at=? WHERE id=?
  `).bind(
    slugify(body.slug || body.title), body.title, body.subtitle || '', body.description || '',
    JSON.stringify(body.tags || []), body.role || '', JSON.stringify(body.tools || []),
    body.year || null, body.date || '', body.category || 'engineering',
    JSON.stringify(body.links || []), body.status || 'draft', body.featured ? 1 : 0,
    body.sortOrder ?? 0, body.timelineRef || null, body.heroMediaId || null, ts, id
  ).run();
  const project = await getProject(env.DB, id);
  return json({ project }, 200, cors);
}

async function handleDeleteProject(env, cors, id) {
  const media = await getProjectMedia(env.DB, id);
  for (const m of media) {
    try { await env.MEDIA.delete(m.r2_key); } catch (_) {}
  }
  await env.DB.prepare('DELETE FROM media_assets WHERE project_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
  return json({ ok: true }, 200, cors);
}

async function handleUpload(request, env, cors) {
  const form = await request.formData();
  const file = form.get('file');
  const projectId = form.get('projectId');
  const slot = form.get('slot') || 'gallery';
  const altText = form.get('altText') || '';
  const caption = form.get('caption') || altText;

  if (!file || typeof file === 'string' || !projectId) {
    return json({ error: 'Missing file or projectId' }, 400, cors);
  }

  const project = await env.DB.prepare('SELECT slug FROM projects WHERE id = ?').bind(projectId).first();
  if (!project) return json({ error: 'Project not found' }, 404, cors);

  const mime = file.type || 'application/octet-stream';
  const ft = fileTypeFromMime(mime);
  if (!ft || !ALLOWED_MIME[ft]?.includes(mime)) {
    return json({ error: `File type not allowed: ${mime}` }, 400, cors);
  }
  if (file.size > (MIME_LIMITS[ft] || 10 * 1024 * 1024)) {
    return json({ error: 'File too large' }, 400, cors);
  }

  const ext = extFromMime(mime, file.name);
  const folder = slotFolder(slot);
  const fname = `${Date.now()}-${uuid().slice(0, 8)}.${ext}`;
  const r2Key = `portfolio/projects/${project.slug}/${folder}/${fname}`;
  const base = (env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const publicUrl = `${base}/${r2Key}`;

  await env.MEDIA.put(r2Key, file.stream(), {
    httpMetadata: { contentType: mime },
  });

  const mediaId = uuid();
  const { results: sortRows } = await env.DB.prepare(
    'SELECT MAX(sort_order) as m FROM media_assets WHERE project_id = ?'
  ).bind(projectId).all();
  const sortOrder = ((sortRows?.[0]?.m) ?? -1) + 1;

  await env.DB.prepare(`
    INSERT INTO media_assets (id, project_id, r2_key, public_url, file_type, mime_type,
      alt_text, caption, sort_order, slot, bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    mediaId, projectId, r2Key, publicUrl, ft, mime, altText, caption, sortOrder, slot, file.size, now()
  ).run();

  if (slot === 'hero') {
    await env.DB.prepare('UPDATE projects SET hero_media_id = ?, updated_at = ? WHERE id = ?')
      .bind(mediaId, now(), projectId).run();
  }

  const row = await env.DB.prepare('SELECT * FROM media_assets WHERE id = ?').bind(mediaId).first();
  return json({ media: row }, 201, cors);
}

async function handleDeleteMedia(env, cors, mediaId) {
  const row = await env.DB.prepare('SELECT * FROM media_assets WHERE id = ?').bind(mediaId).first();
  if (!row) return json({ error: 'Not found' }, 404, cors);
  try { await env.MEDIA.delete(row.r2_key); } catch (_) {}
  await env.DB.prepare('DELETE FROM media_assets WHERE id = ?').bind(mediaId).run();
  await env.DB.prepare('UPDATE projects SET hero_media_id = NULL WHERE hero_media_id = ?').bind(mediaId).run();
  return json({ ok: true }, 200, cors);
}

async function handleReorderMedia(request, env, cors) {
  const { items } = await request.json();
  if (!Array.isArray(items)) return json({ error: 'Invalid' }, 400, cors);
  for (const { id, sortOrder } of items) {
    await env.DB.prepare('UPDATE media_assets SET sort_order = ? WHERE id = ?').bind(sortOrder, id).run();
  }
  return json({ ok: true }, 200, cors);
}

async function importFromJson(env, cors) {
  /* One-time helper: seed from resume_pack if empty */
  const count = await env.DB.prepare('SELECT COUNT(*) as c FROM projects').first();
  if (count?.c > 0) return json({ message: 'DB already has projects' }, 200, cors);
  return json({ message: 'Use admin UI to create projects' }, 200, cors);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);
    const path = url.pathname.replace(/\/$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (!path.startsWith('/api')) {
      const assetUrl = (path === '/' || path === '')
        ? new URL('/index.html', request.url)
        : new URL(request.url);
      const assetRes = await env.ASSETS.fetch(new Request(assetUrl, request));
      if (assetRes.status !== 404 || path === '/' || path === '') return assetRes;
    }

    try {
      /* Public */
      if (path === '/api/public/projects' && request.method === 'GET') {
        return handlePublicProjects(env, cors);
      }

      /* Auth */
      if (path === '/api/auth/login' && request.method === 'POST') {
        return handleLogin(request, env, cors);
      }
      if (path === '/api/auth/logout' && request.method === 'POST') {
        return handleLogout(cors);
      }
      if (path === '/api/auth/me' && request.method === 'GET') {
        return handleMe(request, env, cors);
      }

      /* Protected */
      if (!(await requireAuth(request, env))) {
        return json({ error: 'Unauthorized' }, 401, cors);
      }

      if (path === '/api/projects' && request.method === 'GET') {
        return handleAdminProjects(request, env, cors);
      }
      if (path === '/api/projects' && request.method === 'POST') {
        return handleCreateProject(request, env, cors);
      }

      const projMatch = path.match(/^\/api\/projects\/([^/]+)$/);
      if (projMatch && request.method === 'GET') {
        const p = await getProject(env.DB, projMatch[1]);
        if (!p) return json({ error: 'Not found' }, 404, cors);
        return json({ project: p }, 200, cors);
      }
      if (projMatch && request.method === 'PUT') {
        return handleUpdateProject(request, env, cors, projMatch[1]);
      }
      if (projMatch && request.method === 'DELETE') {
        return handleDeleteProject(env, cors, projMatch[1]);
      }

      if (path === '/api/media/upload' && request.method === 'POST') {
        return handleUpload(request, env, cors);
      }
      if (path === '/api/media/reorder' && request.method === 'PUT') {
        return handleReorderMedia(request, env, cors);
      }

      const mediaMatch = path.match(/^\/api\/media\/([^/]+)$/);
      if (mediaMatch && request.method === 'DELETE') {
        return handleDeleteMedia(env, cors, mediaMatch[1]);
      }

      return json({ error: 'Not found' }, 404, cors);
    } catch (err) {
      console.error(err);
      return json({ error: err.message || 'Server error' }, 500, cors);
    }
  },
};
