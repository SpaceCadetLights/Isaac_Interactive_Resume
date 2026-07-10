/** CMS API base URL — empty = static resume_pack.json only. */
export function getApiBaseUrl(config = {}) {
  const fromConfig = config?.apiBaseUrl || '';
  if (fromConfig) return String(fromConfig).replace(/\/$/, '');
  return '';
}

export function getAdminUrl(config = {}) {
  const api = getApiBaseUrl(config);
  if (api) return `${api}/`;
  return '';
}

export async function fetchPublicProjects(apiBase) {
  if (!apiBase) return null;
  try {
    const r = await fetch(`${apiBase}/api/public/projects`, { cache: 'no-store' });
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

/** Full resume pack from cloud (resume, timeline, projects, config). */
export async function fetchPublicPack(apiBase) {
  if (!apiBase) return null;
  try {
    const r = await fetch(`${apiBase}/api/public/pack`, { cache: 'no-store' });
    if (!r.ok) return null;
    const pack = await r.json();
    if (!pack || typeof pack !== 'object') return null;
    return pack;
  } catch {
    return null;
  }
}

/** Merge CMS organizations with JSON stubs by slug. */
export function applyCmsOrganizations(data, cmsPack) {
  if (!data || !cmsPack) return data;
  const cmsOrgs = Array.isArray(cmsPack.organizations) ? cmsPack.organizations : [];
  const jsonOrgs = Array.isArray(data.organizations) ? data.organizations : [];
  const cmsBySlug = Object.fromEntries(cmsOrgs.filter(o => o.slug).map(o => [o.slug, o]));
  const merged = [];
  const seen = new Set();

  cmsOrgs.forEach(o => {
    merged.push(o);
    if (o.slug) seen.add(o.slug);
    if (o.id) seen.add(o.id);
  });

  jsonOrgs.forEach(o => {
    const slug = o.slug || o.id;
    if (slug && cmsBySlug[slug]) return;
    const key = slug || o.id;
    if (!key || seen.has(key)) return;
    merged.push(o);
    seen.add(key);
  });

  const organizationById = {};
  merged.forEach(o => {
    if (o.id) organizationById[o.id] = o;
    if (o.slug) organizationById[o.slug] = o;
  });

  return { ...data, organizations: merged, organizationById };
}

/** Merge CMS projects (media + live edits) with JSON stubs by slug. */
export function applyCmsProjects(data, cmsPack) {
  if (!data || !cmsPack) return data;
  let next = applyCmsOrganizations(data, cmsPack);
  const cmsProjects = Array.isArray(cmsPack.projects) ? cmsPack.projects : [];
  const jsonProjects = Array.isArray(next.projects) ? next.projects : [];
  const cmsBySlug = Object.fromEntries(
    cmsProjects.filter(p => p.slug).map(p => [p.slug, p])
  );
  const merged = [];
  const seen = new Set();

  cmsProjects.forEach(p => {
    merged.push(p);
    if (p.slug) seen.add(p.slug);
    if (p.id) seen.add(p.id);
  });

  jsonProjects.forEach(p => {
    const slug = p.slug || p.id;
    if (slug && cmsBySlug[slug]) return;
    const key = slug || p.id;
    if (!key || seen.has(key)) return;
    merged.push(p);
    seen.add(key);
  });

  const projectById = {};
  merged.forEach(p => {
    if (p.id) projectById[p.id] = p;
    if (p.slug) projectById[p.slug] = p;
  });

  return {
    ...next,
    config: {
      ...next.config,
      ...(cmsPack.config || {}),
      apiBaseUrl: next.config?.apiBaseUrl || cmsPack.config?.apiBaseUrl,
    },
    projects: merged,
    projectById,
  };
}

/** Normalize resume_pack / stub project for CMS import API. */
export function normalizeProjectForImport(p) {
  if (!p || typeof p !== 'object') return null;
  const slug = (p.slug || p.id || p.title || '').toString().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  if (!slug) return null;
  return {
    title: p.title || 'Untitled',
    slug,
    subtitle: p.subtitle || p.summary || '',
    description: p.description || p.details || '',
    tags: Array.isArray(p.tags) ? p.tags : [],
    role: p.role || '',
    tools: Array.isArray(p.tools) ? p.tools : [],
    year: p.year || null,
    date: p.date || '',
    category: p.category || 'engineering',
    links: Array.isArray(p.links) ? p.links : [],
    status: p.status === 'draft' ? 'draft' : 'published',
    featured: !!p.featured,
    featuredDiscover: !!p.featuredDiscover,
    sortOrder: p.sortOrder ?? 0,
    organizationId: p.organizationId || p.organization_id || null,
    entryKind: p.entryKind || p.entry_kind || 'project',
    entryKindLabel: p.entryKindLabel || p.entry_kind_label || '',
    timelineRef: p.timelineRef || p.timeline_ref || null,
  };
}
