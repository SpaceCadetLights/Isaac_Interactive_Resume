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

function sessionSecret(env) {
  const trimmed = String(env.SESSION_SECRET || '').trim();
  return trimmed || 'change-me-dev-only';
}

function adminPassword(env) {
  return String(env.ADMIN_PASSWORD || '').trim();
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function signSession(env) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const payload = new TextEncoder().encode(String(exp));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(sessionSecret(env)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, payload);
  return `${exp}.${bytesToBase64(new Uint8Array(sig))}`;
}

async function verifySession(token, env) {
  if (!token) return false;
  const [expStr, sigB64] = token.split('.');
  if (!expStr || !sigB64) return false;
  if (Date.now() > Number(expStr)) return false;
  try {
    const payload = new TextEncoder().encode(expStr);
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(sessionSecret(env)),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sig = base64ToBytes(sigB64);
    return crypto.subtle.verify('HMAC', key, sig, payload);
  } catch {
    return false;
  }
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

async function rowToProject(row, mediaRows, orgSlugById) {
  const media = (mediaRows || []).filter(m => m.project_id === row.id).sort((a, b) => a.sort_order - b.sort_order);
  const hero = media.find(m => m.id === row.hero_media_id) || media.find(m => m.slot === 'hero');
  const orgSlug = row.organization_id ? (orgSlugById?.[row.organization_id] || null) : null;
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
    featuredDiscover: !!row.featured_discover,
    sortOrder: row.sort_order,
    organizationId: orgSlug || row.organization_id || null,
    timelineRef: row.timeline_ref,
    entryKind: row.entry_kind || 'project',
    entryKindLabel: row.entry_kind_label || '',
    hero: hero ? mediaAssetToLegacy(hero) : null,
    media: media.map(mediaAssetToLegacy),
    updatedAt: row.updated_at,
  };
}

function mediaAssetToLegacy(m) {
  if (m.file_type === 'link') return { type: 'link', url: m.public_url, label: m.caption };
  const item = {
    id: m.id,
    type: m.file_type === 'video' ? 'video' : m.file_type === 'pdf' ? 'link' : 'image',
    src: m.r2_key,
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

function rowToOrganization(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    tags: parseJsonField(row.tags, []),
    website: row.website || '',
    date: row.date || '',
    category: row.category,
    links: parseJsonField(row.links, []),
    status: row.status,
    featured: !!row.featured,
    sortOrder: row.sort_order,
    timelineRef: row.timeline_ref,
    updatedAt: row.updated_at,
  };
}

async function listOrganizations(db, publishedOnly) {
  const q = publishedOnly
    ? "SELECT * FROM organizations WHERE status = 'published' ORDER BY sort_order ASC, updated_at DESC"
    : 'SELECT * FROM organizations ORDER BY sort_order ASC, updated_at DESC';
  const { results } = await db.prepare(q).all();
  return (results || []).map(rowToOrganization);
}

async function getOrganization(db, id) {
  const row = await db.prepare('SELECT * FROM organizations WHERE id = ? OR slug = ?').bind(id, id).first();
  if (!row) return null;
  return rowToOrganization(row);
}

async function handleAdminOrganizations(env, cors) {
  const organizations = await listOrganizations(env.DB, false);
  return json({ organizations }, 200, cors);
}

async function handleCreateOrganization(request, env, cors) {
  const body = await request.json();
  const id = uuid();
  const slug = slugify(body.slug || body.title) || id.slice(0, 8);
  const ts = now();
  await env.DB.prepare(`
    INSERT INTO organizations (id, slug, title, subtitle, description, tags, website, date,
      category, links, status, featured, sort_order, timeline_ref, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, slug, body.title || 'Untitled', body.subtitle || '', body.description || '',
    JSON.stringify(body.tags || []), body.website || '', body.date || '',
    body.category || 'venture', JSON.stringify(body.links || []),
    body.status || 'draft', body.featured ? 1 : 0, body.sortOrder ?? 0,
    body.timelineRef || null, ts, ts
  ).run();
  const organization = await getOrganization(env.DB, id);
  return json({ organization }, 201, cors);
}

async function handleUpdateOrganization(request, env, cors, id) {
  const body = await request.json();
  const existing = await env.DB.prepare('SELECT id FROM organizations WHERE id = ?').bind(id).first();
  if (!existing) return json({ error: 'Not found' }, 404, cors);
  const ts = now();
  await env.DB.prepare(`
    UPDATE organizations SET slug=?, title=?, subtitle=?, description=?, tags=?, website=?, date=?,
      category=?, links=?, status=?, featured=?, sort_order=?, timeline_ref=?, updated_at=? WHERE id=?
  `).bind(
    slugify(body.slug || body.title), body.title, body.subtitle || '', body.description || '',
    JSON.stringify(body.tags || []), body.website || '', body.date || '',
    body.category || 'venture', JSON.stringify(body.links || []),
    body.status || 'draft', body.featured ? 1 : 0, body.sortOrder ?? 0,
    body.timelineRef || null, ts, id
  ).run();
  const organization = await getOrganization(env.DB, id);
  return json({ organization }, 200, cors);
}

async function handleDeleteOrganization(env, cors, id) {
  const row = await env.DB.prepare('SELECT id FROM organizations WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'Not found' }, 404, cors);
  const child = await env.DB.prepare('SELECT COUNT(*) as c FROM projects WHERE organization_id = ?').bind(id).first();
  if (child?.c > 0) {
    return json({ error: 'Cannot delete organization with linked projects. Reassign or delete projects first.' }, 400, cors);
  }
  await env.DB.prepare('DELETE FROM organizations WHERE id = ?').bind(id).run();
  return json({ ok: true }, 200, cors);
}

function normalizeImportOrganization(body) {
  const slug = slugify(body.slug || body.id || body.title);
  if (!slug) return null;
  return {
    title: body.title || 'Untitled',
    slug,
    sourceId: body.id ? slugify(String(body.id)) : null,
    subtitle: body.subtitle || body.summary || '',
    description: body.description || body.details || '',
    tags: Array.isArray(body.tags) ? body.tags : [],
    website: body.website || '',
    date: body.date || '',
    category: body.category || 'venture',
    links: Array.isArray(body.links) ? body.links : [],
    status: body.status === 'draft' ? 'draft' : 'published',
    featured: body.featured ? 1 : 0,
    sortOrder: body.sortOrder ?? 0,
    timelineRef: body.timelineRef || body.timeline_ref || null,
  };
}

async function importOrganizationsFromList(env, items) {
  const ts = now();
  let created = 0;
  let updated = 0;
  for (const raw of items) {
    const o = normalizeImportOrganization(raw);
    if (!o) continue;
    let existing = await env.DB.prepare('SELECT * FROM organizations WHERE slug = ?').bind(o.slug).first();
    if (!existing && o.sourceId && o.sourceId !== o.slug) {
      existing = await env.DB.prepare('SELECT * FROM organizations WHERE slug = ?').bind(o.sourceId).first();
      if (existing) {
        await env.DB.prepare('UPDATE organizations SET slug = ?, updated_at = ? WHERE id = ?')
          .bind(o.slug, ts, existing.id).run();
        existing = { ...existing, slug: o.slug };
      }
    }
    if (existing) {
      await env.DB.prepare(`
        UPDATE organizations SET slug=?, title=?, subtitle=?, description=?, tags=?, website=?, date=?,
          category=?, links=?, status=?, featured=?, sort_order=?, timeline_ref=?, updated_at=? WHERE id=?
      `).bind(
        o.slug, o.title, o.subtitle, o.description, JSON.stringify(o.tags), o.website, o.date,
        o.category, JSON.stringify(o.links), o.status, o.featured, o.sortOrder, o.timelineRef, ts, existing.id
      ).run();
      updated++;
    } else {
      const id = uuid();
      await env.DB.prepare(`
        INSERT INTO organizations (id, slug, title, subtitle, description, tags, website, date,
          category, links, status, featured, sort_order, timeline_ref, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, o.slug, o.title, o.subtitle, o.description, JSON.stringify(o.tags), o.website, o.date,
        o.category, JSON.stringify(o.links), o.status, o.featured, o.sortOrder, o.timelineRef, ts, ts
      ).run();
      created++;
    }
  }
  return { created, updated, total: items.length };
}

async function handleLogin(request, env, cors) {
  const { password } = await request.json();
  const pwd = String(password || '').trim();
  const expected = adminPassword(env);
  if (!expected) {
    return json({ error: 'Admin password not configured on server. Run: wrangler secret put ADMIN_PASSWORD' }, 503, cors);
  }
  if (!pwd || pwd !== expected) {
    return json({ error: 'Invalid password' }, 401, cors);
  }
  const token = await signSession(env);
  return json({ ok: true, token }, 200, {
    ...cors,
    'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400),
  });
}

async function handleAuthStatus(env, cors) {
  return json({
    loginConfigured: !!adminPassword(env),
    sessionConfigured: !!String(env.SESSION_SECRET || '').trim(),
  }, 200, cors);
}

async function handleLogout(cors) {
  return json({ ok: true }, 200, {
    ...cors,
    'Set-Cookie': sessionCookie('', 0),
  });
}

async function handleMe(request, env, cors) {
  const authed = await requireAuth(request, env);
  const siteFromOrigins = (env.ALLOWED_ORIGINS || '').split(',')
    .map(s => s.trim())
    .find(o => o && !o.includes('workers.dev') && !o.includes('localhost') && !o.includes('127.0.0.1'));
  return json({
    authed: !!authed,
    mediaBaseUrl: env.R2_PUBLIC_BASE_URL || '',
    portfolioUrl: env.PORTFOLIO_SITE_URL || (siteFromOrigins ? `${siteFromOrigins}/portfolio/` : ''),
  }, 200, cors);
}

async function listProjects(db, publishedOnly) {
  const q = publishedOnly
    ? "SELECT * FROM projects WHERE status = 'published' ORDER BY sort_order ASC, updated_at DESC"
    : 'SELECT * FROM projects ORDER BY sort_order ASC, updated_at DESC';
  const { results: projects } = await db.prepare(q).all();
  const { results: allMedia } = await db.prepare('SELECT * FROM media_assets ORDER BY sort_order ASC').all();
  const { results: orgs } = await db.prepare('SELECT id, slug FROM organizations').all();
  const orgSlugById = Object.fromEntries((orgs || []).map(o => [o.id, o.slug]));
  return Promise.all((projects || []).map(p => rowToProject(p, allMedia, orgSlugById)));
}

async function getProject(db, id) {
  const row = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
  if (!row) return null;
  const media = await getProjectMedia(db, id);
  const { results: orgs } = await db.prepare('SELECT id, slug FROM organizations').all();
  const orgSlugById = Object.fromEntries((orgs || []).map(o => [o.id, o.slug]));
  return rowToProject(row, media, orgSlugById);
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

async function resolveOrganizationId(db, organizationIdOrSlug) {
  if (!organizationIdOrSlug) return null;
  const row = await db.prepare('SELECT id FROM organizations WHERE id = ? OR slug = ?')
    .bind(organizationIdOrSlug, organizationIdOrSlug).first();
  return row?.id || null;
}

async function handleCreateProject(request, env, cors) {
  const body = await request.json();
  const id = uuid();
  const slug = slugify(body.slug || body.title) || id.slice(0, 8);
  const ts = now();
  const orgId = await resolveOrganizationId(env.DB, body.organizationId);
  await env.DB.prepare(`
    INSERT INTO projects (id, slug, title, subtitle, description, tags, role, tools, year, date,
      category, links, status, featured, featured_discover, entry_kind, entry_kind_label,
      sort_order, organization_id, timeline_ref, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, slug, body.title || 'Untitled', body.subtitle || '', body.description || '',
    JSON.stringify(body.tags || []), body.role || '', JSON.stringify(body.tools || []),
    body.year || null, body.date || '', body.category || 'engineering',
    JSON.stringify(body.links || []), body.status || 'draft', body.featured ? 1 : 0,
    body.featuredDiscover ? 1 : 0, body.entryKind || 'project', body.entryKindLabel || '',
    body.sortOrder ?? 0, orgId, body.timelineRef || null, ts, ts
  ).run();
  const project = await getProject(env.DB, id);
  return json({ project }, 201, cors);
}

async function handleUpdateProject(request, env, cors, id) {
  const body = await request.json();
  const existing = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first();
  if (!existing) return json({ error: 'Not found' }, 404, cors);
  const ts = now();
  const orgId = await resolveOrganizationId(env.DB, body.organizationId);
  await env.DB.prepare(`
    UPDATE projects SET slug=?, title=?, subtitle=?, description=?, tags=?, role=?, tools=?,
      year=?, date=?, category=?, links=?, status=?, featured=?, featured_discover=?,
      entry_kind=?, entry_kind_label=?, sort_order=?, organization_id=?, timeline_ref=?,
      hero_media_id=?, updated_at=? WHERE id=?
  `).bind(
    slugify(body.slug || body.title), body.title, body.subtitle || '', body.description || '',
    JSON.stringify(body.tags || []), body.role || '', JSON.stringify(body.tools || []),
    body.year || null, body.date || '', body.category || 'engineering',
    JSON.stringify(body.links || []), body.status || 'draft', body.featured ? 1 : 0,
    body.featuredDiscover ? 1 : 0, body.entryKind || 'project', body.entryKindLabel || '',
    body.sortOrder ?? 0, orgId, body.timelineRef || null, body.heroMediaId || null, ts, id
  ).run();
  const project = await getProject(env.DB, id);
  return json({ project }, 200, cors);
}

async function handleDeleteProject(env, cors, id) {
  const row = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'Not found' }, 404, cors);
  await deleteProjectById(env, id);
  return json({ ok: true }, 200, cors);
}

function normalizeImportProject(body) {
  const slug = slugify(body.slug || body.id || body.title);
  if (!slug) return null;
  return {
    title: body.title || 'Untitled',
    slug,
    sourceId: body.id ? slugify(String(body.id)) : null,
    subtitle: body.subtitle || body.summary || '',
    description: body.description || body.details || '',
    tags: Array.isArray(body.tags) ? body.tags : [],
    role: body.role || '',
    tools: Array.isArray(body.tools) ? body.tools : [],
    year: body.year || null,
    date: body.date || '',
    category: body.category || 'engineering',
    links: Array.isArray(body.links) ? body.links : [],
    status: body.status === 'draft' ? 'draft' : 'published',
    featured: body.featured ? 1 : 0,
    featuredDiscover: body.featuredDiscover ? 1 : 0,
    sortOrder: body.sortOrder ?? 0,
    organizationId: body.organizationId || body.organization_id || null,
    timelineRef: body.timelineRef || body.timeline_ref || null,
    entryKind: body.entryKind || body.entry_kind || 'project',
    entryKindLabel: body.entryKindLabel || body.entry_kind_label || '',
    incomingMediaCount: Array.isArray(body.media) ? body.media.length : 0,
  };
}

function projectFieldChanges(existing, incoming) {
  const changes = [];
  const cmp = (field, a, b) => {
    const left = JSON.stringify(a ?? '');
    const right = JSON.stringify(b ?? '');
    if (left !== right) changes.push(field);
  };
  cmp('title', existing.title, incoming.title);
  cmp('subtitle', existing.subtitle, incoming.subtitle);
  cmp('description', existing.description, incoming.description);
  cmp('tags', parseJsonField(existing.tags, []), incoming.tags);
  cmp('role', existing.role, incoming.role);
  cmp('tools', parseJsonField(existing.tools, []), incoming.tools);
  cmp('year', existing.year, incoming.year);
  cmp('date', existing.date, incoming.date);
  cmp('category', existing.category, incoming.category);
  cmp('links', parseJsonField(existing.links, []), incoming.links);
  cmp('status', existing.status, incoming.status);
  cmp('featured', !!existing.featured, !!incoming.featured);
  cmp('featuredDiscover', !!existing.featured_discover, !!incoming.featuredDiscover);
  cmp('sortOrder', existing.sort_order, incoming.sortOrder);
  cmp('organizationId', existing.organization_id, incoming.organizationId);
  cmp('entryKind', existing.entry_kind || 'project', incoming.entryKind || 'project');
  cmp('entryKindLabel', existing.entry_kind_label || '', incoming.entryKindLabel || '');
  cmp('timelineRef', existing.timeline_ref, incoming.timelineRef);
  return changes;
}

function timelineRefIndex(pack) {
  const ids = new Set();
  (pack?.timeline || []).forEach(t => {
    if (t?.id) ids.add(String(t.id));
    if (t?.slug) ids.add(String(t.slug));
    if (t?.date) ids.add(String(t.date));
  });
  return ids;
}

async function countMediaForProject(db, projectId) {
  const row = await db.prepare('SELECT COUNT(*) as c FROM media_assets WHERE project_id = ?').bind(projectId).first();
  return row?.c || 0;
}

async function analyzeProjectImport(env, items, pack = null) {
  const { results: allDb } = await env.DB.prepare('SELECT * FROM projects').all();
  const dbBySlug = Object.fromEntries((allDb || []).map(r => [r.slug, r]));
  const mediaCounts = {};
  for (const row of allDb || []) {
    mediaCounts[row.id] = await countMediaForProject(env.DB, row.id);
  }

  const incoming = [];
  const skipped = [];
  for (const raw of items) {
    const p = normalizeImportProject(raw);
    if (!p) {
      skipped.push({ title: raw?.title || '(invalid)', reason: 'Missing title/slug' });
      continue;
    }
    incoming.push({ raw, p });
  }

  const incomingSlugs = new Set(incoming.map(i => i.p.slug));
  const created = [];
  const updated = [];
  const unchanged = [];
  const mediaNotes = [];
  const slugConflicts = [];
  const timelineIssues = [];
  const timelineIds = pack ? timelineRefIndex(pack) : null;

  for (const { raw, p } of incoming) {
    let existing = dbBySlug[p.slug];
    let matchedBy = existing ? 'slug' : null;

    if (!existing && p.sourceId && p.sourceId !== p.slug && dbBySlug[p.sourceId]) {
      existing = dbBySlug[p.sourceId];
      matchedBy = 'id';
      slugConflicts.push({
        type: 'slug-rename',
        previousSlug: p.sourceId,
        newSlug: p.slug,
        title: p.title,
        mediaCount: mediaCounts[existing.id] || 0,
        message: `JSON id "${p.sourceId}" maps to existing project, but slug changed to "${p.slug}". Media stays on the old slug unless you edit the project manually — keep slugs stable to preserve R2 uploads.`,
      });
    }

    const cloudMedia = existing ? (mediaCounts[existing.id] || 0) : 0;

    if (p.incomingMediaCount > 0) {
      mediaNotes.push({
        slug: p.slug,
        title: p.title,
        jsonMediaRefs: p.incomingMediaCount,
        cloudMedia,
        message: cloudMedia
          ? `JSON lists ${p.incomingMediaCount} media path(s); ${cloudMedia} uploaded file(s) in cloud are kept (paths in JSON are not re-imported).`
          : `JSON lists ${p.incomingMediaCount} media path(s) but none are uploaded yet — add photos in Projects → Edit.`,
      });
    } else if (existing && cloudMedia > 0) {
      mediaNotes.push({
        slug: p.slug,
        title: p.title,
        jsonMediaRefs: 0,
        cloudMedia,
        message: `${cloudMedia} uploaded file(s) stay attached via slug "${p.slug}".`,
      });
    }

    if (timelineIds && p.timelineRef && !timelineIds.has(String(p.timelineRef))) {
      timelineIssues.push({
        slug: p.slug,
        title: p.title,
        timelineRef: p.timelineRef,
        message: `timelineRef "${p.timelineRef}" not found in incoming timeline array.`,
      });
    }

    if (!existing) {
      created.push({ slug: p.slug, title: p.title, matchedBy: null });
      continue;
    }

    const changes = projectFieldChanges(existing, p);
    const entry = {
      slug: p.slug,
      title: p.title,
      mediaCount: cloudMedia,
      matchedBy,
      fieldsChanged: changes,
    };
    if (changes.length) updated.push(entry);
    else unchanged.push({ slug: p.slug, title: p.title, mediaCount: cloudMedia, matchedBy });
  }

  const orphaned = (allDb || [])
    .filter(r => !incomingSlugs.has(r.slug))
    .map(r => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      status: r.status,
      mediaCount: mediaCounts[r.id] || 0,
    }));

  return {
    summary: {
      incoming: incoming.length,
      created: created.length,
      updated: updated.length,
      unchanged: unchanged.length,
      orphaned: orphaned.length,
      skipped: skipped.length,
      warnings: slugConflicts.length + mediaNotes.filter(n => n.jsonMediaRefs && !n.cloudMedia).length + timelineIssues.length,
    },
    created,
    updated,
    unchanged,
    orphaned,
    skipped,
    slugConflicts,
    mediaNotes,
    timelineIssues,
  };
}

async function deleteProjectById(env, id) {
  const media = await getProjectMedia(env.DB, id);
  for (const m of media) {
    try { await env.MEDIA.delete(m.r2_key); } catch (_) {}
  }
  await env.DB.prepare('DELETE FROM media_assets WHERE project_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
}

async function applyOrphanAction(env, orphaned, action) {
  let drafted = 0;
  let deleted = 0;
  if (!action || action === 'keep' || !orphaned?.length) return { drafted, deleted };

  for (const row of orphaned) {
    if (action === 'draft') {
      await env.DB.prepare("UPDATE projects SET status = 'draft', updated_at = ? WHERE id = ?")
        .bind(now(), row.id).run();
      drafted++;
    } else if (action === 'delete') {
      await deleteProjectById(env, row.id);
      deleted++;
    }
  }
  return { drafted, deleted };
}

async function importProjectsFromList(env, items, options = {}) {
  const ts = now();
  const analysis = await analyzeProjectImport(env, items, options.pack || null);
  let created = 0;
  let updated = 0;

  for (const raw of items) {
    const p = normalizeImportProject(raw);
    if (!p) continue;

    let existing = await env.DB.prepare('SELECT * FROM projects WHERE slug = ?').bind(p.slug).first();
    if (!existing && p.sourceId && p.sourceId !== p.slug) {
      existing = await env.DB.prepare('SELECT * FROM projects WHERE slug = ?').bind(p.sourceId).first();
      if (existing) {
        await env.DB.prepare('UPDATE projects SET slug = ?, updated_at = ? WHERE id = ?')
          .bind(p.slug, ts, existing.id).run();
        existing = { ...existing, slug: p.slug };
      }
    }

    if (existing) {
      const changes = projectFieldChanges(existing, p);
      const orgId = await resolveOrganizationId(env.DB, p.organizationId);
      if (changes.length || existing.slug !== p.slug) {
        await env.DB.prepare(`
          UPDATE projects SET slug=?, title=?, subtitle=?, description=?, tags=?, role=?, tools=?,
            year=?, date=?, category=?, links=?, status=?, featured=?, featured_discover=?,
            entry_kind=?, entry_kind_label=?, sort_order=?, organization_id=?, timeline_ref=?, updated_at=? WHERE id=?
        `).bind(
          p.slug, p.title, p.subtitle, p.description, JSON.stringify(p.tags), p.role, JSON.stringify(p.tools),
          p.year, p.date, p.category, JSON.stringify(p.links), p.status, p.featured, p.featuredDiscover,
          p.entryKind || 'project', p.entryKindLabel || '', p.sortOrder, orgId, p.timelineRef, ts, existing.id
        ).run();
        updated++;
      }
    } else {
      const id = uuid();
      const orgId = await resolveOrganizationId(env.DB, p.organizationId);
      await env.DB.prepare(`
        INSERT INTO projects (id, slug, title, subtitle, description, tags, role, tools, year, date,
          category, links, status, featured, featured_discover, entry_kind, entry_kind_label,
          sort_order, organization_id, timeline_ref, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, p.slug, p.title, p.subtitle, p.description, JSON.stringify(p.tags), p.role,
        JSON.stringify(p.tools), p.year, p.date, p.category, JSON.stringify(p.links), p.status,
        p.featured, p.featuredDiscover, p.entryKind || 'project', p.entryKindLabel || '',
        p.sortOrder, orgId, p.timelineRef, ts, ts
      ).run();
      created++;
    }
  }

  const incomingSlugs = new Set(items.map(raw => normalizeImportProject(raw)?.slug).filter(Boolean));
  const { results: allDb } = await env.DB.prepare('SELECT * FROM projects').all();
  const toOrphan = (allDb || []).filter(r => !incomingSlugs.has(r.slug)).map(r => ({
    id: r.id, slug: r.slug, title: r.title, status: r.status,
  }));
  const orphanResult = await applyOrphanAction(env, toOrphan, options.orphanAction);

  return {
    created,
    updated,
    total: items.length,
    analysis,
    orphans: { ...orphanResult, kept: toOrphan.length - orphanResult.drafted - orphanResult.deleted },
  };
}

async function handleImportProjects(request, env, cors) {
  const body = await request.json();
  const items = Array.isArray(body.projects) ? body.projects : [];
  if (!items.length) return json({ error: 'projects array required' }, 400, cors);
  const result = await importProjectsFromList(env, items, {
    orphanAction: body.orphanAction || 'keep',
    pack: body.pack || null,
  });
  return json({ ok: true, ...result }, 200, cors);
}

async function handlePreviewProjects(request, env, cors) {
  const body = await request.json();
  const items = Array.isArray(body.projects) ? body.projects : [];
  if (!items.length) return json({ error: 'projects array required' }, 400, cors);
  const analysis = await analyzeProjectImport(env, items, body.pack || null);
  return json({ ok: true, analysis }, 200, cors);
}

async function handlePreviewPack(request, env, cors) {
  const body = await request.json();
  const pack = body.pack && typeof body.pack === 'object' ? body.pack : body;
  if (!pack || typeof pack !== 'object') return json({ error: 'Invalid pack JSON' }, 400, cors);
  const projects = Array.isArray(pack.projects) ? pack.projects : [];
  const analysis = projects.length
    ? await analyzeProjectImport(env, projects, pack)
    : { summary: { incoming: 0, created: 0, updated: 0, unchanged: 0, orphaned: 0, skipped: 0, warnings: 0 },
        created: [], updated: [], unchanged: [], orphaned: [], skipped: [], slugConflicts: [], mediaNotes: [], timelineIssues: [] };
  const stored = await getStoredPack(env);
  return json({
    ok: true,
    resume: {
      hasIncoming: !!(pack.resume || pack.timeline || pack.skills_markdown),
      hasStored: !!(stored?.resume || stored?.timeline),
      willReplace: !!(pack.resume || pack.timeline || pack.skills_markdown),
    },
    analysis,
  }, 200, cors);
}

async function getStoredPack(env) {
  const row = await env.DB.prepare('SELECT json FROM site_pack WHERE id = ?').bind('main').first();
  if (!row?.json) return null;
  try { return JSON.parse(row.json); } catch { return null; }
}

async function buildPackResponse(env, publishedOnly) {
  const stored = await getStoredPack(env);
  const projects = await listProjects(env.DB, publishedOnly);
  const organizations = await listOrganizations(env.DB, publishedOnly);
  const base = stored && typeof stored === 'object' ? stored : { version: 2 };
  return {
    ...base,
    version: base.version || 2,
    config: {
      ...(base.config || {}),
      mediaBaseUrl: env.R2_PUBLIC_BASE_URL || base.config?.mediaBaseUrl || '',
    },
    organizations,
    projects,
  };
}

async function handlePublicPack(env, cors) {
  const pack = await buildPackResponse(env, true);
  return json(pack, 200, cors);
}

async function handleGetPack(env, cors) {
  const pack = await buildPackResponse(env, false);
  return json({ pack }, 200, cors);
}

async function handleImportPack(request, env, cors) {
  const body = await request.json();
  const pack = body.pack && typeof body.pack === 'object' ? body.pack : body;
  if (!pack || typeof pack !== 'object') return json({ error: 'Invalid pack JSON' }, 400, cors);
  const orphanAction = body.orphanAction || 'keep';

  const ts = now();
  const packForStore = { ...pack };
  await env.DB.prepare(`
    INSERT INTO site_pack (id, json, updated_at) VALUES ('main', ?, ?)
    ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at
  `).bind(JSON.stringify(packForStore), ts).run();

  let projectResult = { created: 0, updated: 0, total: 0, analysis: null, orphans: { drafted: 0, deleted: 0, kept: 0 } };
  let orgResult = { created: 0, updated: 0, total: 0 };
  if (Array.isArray(pack.organizations) && pack.organizations.length) {
    orgResult = await importOrganizationsFromList(env, pack.organizations);
  }
  if (Array.isArray(pack.projects) && pack.projects.length) {
    projectResult = await importProjectsFromList(env, pack.projects, { orphanAction, pack });
  }

  return json({ ok: true, resumeSaved: true, orphanAction, organizations: orgResult, ...projectResult }, 200, cors);
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
      if ((path === '/' || path === '') && request.method === 'GET') {
        const indexReq = new Request(new URL('/index.html', request.url), {
          method: 'GET',
          headers: request.headers,
        });
        const indexRes = await env.ASSETS.fetch(indexReq);
        if (indexRes.status === 200) {
          return new Response(indexRes.body, {
            status: 200,
            headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-cache' },
          });
        }
      }
      return env.ASSETS.fetch(request);
    }

    try {
      /* Public */
      if (path === '/api/public/projects' && request.method === 'GET') {
        return handlePublicProjects(env, cors);
      }
      if (path === '/api/public/pack' && request.method === 'GET') {
        return handlePublicPack(env, cors);
      }
      if (path === '/api/public/organizations' && request.method === 'GET') {
        const organizations = await listOrganizations(env.DB, true);
        return json({ organizations }, 200, cors);
      }
      if (path === '/api/auth/status' && request.method === 'GET') {
        return handleAuthStatus(env, cors);
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
      if (path === '/api/organizations' && request.method === 'GET') {
        return handleAdminOrganizations(env, cors);
      }
      if (path === '/api/organizations' && request.method === 'POST') {
        return handleCreateOrganization(request, env, cors);
      }
      if (path === '/api/projects/import' && request.method === 'POST') {
        return handleImportProjects(request, env, cors);
      }
      if (path === '/api/projects/preview' && request.method === 'POST') {
        return handlePreviewProjects(request, env, cors);
      }
      if (path === '/api/pack' && request.method === 'GET') {
        return handleGetPack(env, cors);
      }
      if (path === '/api/pack/preview' && request.method === 'POST') {
        return handlePreviewPack(request, env, cors);
      }
      if (path === '/api/pack/import' && request.method === 'POST') {
        return handleImportPack(request, env, cors);
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

      const orgMatch = path.match(/^\/api\/organizations\/([^/]+)$/);
      if (orgMatch && request.method === 'GET') {
        const o = await getOrganization(env.DB, orgMatch[1]);
        if (!o) return json({ error: 'Not found' }, 404, cors);
        return json({ organization: o }, 200, cors);
      }
      if (orgMatch && request.method === 'PUT') {
        return handleUpdateOrganization(request, env, cors, orgMatch[1]);
      }
      if (orgMatch && request.method === 'DELETE') {
        return handleDeleteOrganization(env, cors, orgMatch[1]);
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
