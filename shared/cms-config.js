/** CMS API base URL — empty = static resume_pack.json only. */
export function getApiBaseUrl(config = {}) {
  const fromConfig = config?.apiBaseUrl || '';
  if (fromConfig) return String(fromConfig).replace(/\/$/, '');
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

export function applyCmsProjects(data, cmsPack) {
  if (!data || !cmsPack?.projects?.length) return data;
  const projects = cmsPack.projects;
  const projectById = {};
  projects.forEach(p => {
    projectById[p.id] = p;
    if (p.slug) projectById[p.slug] = p;
  });
  return {
    ...data,
    config: {
      ...data.config,
      ...(cmsPack.config || {}),
      apiBaseUrl: data.config?.apiBaseUrl || cmsPack.config?.apiBaseUrl,
    },
    projects,
    projectById,
  };
}
