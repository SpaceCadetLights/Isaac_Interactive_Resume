/** Admin copy — keep in sync with ../shared/resume-pack-schema.js */

export const PACK_VERSION = 2;

/** Discover / Projects filter defaults — slug values stored on projects. */
export const DEFAULT_CATEGORIES = ['venture', 'engineering', 'community', 'art'];

/** Human labels shown on the public portfolio filters. */
export const CATEGORY_LABELS = {
  venture: 'Products',
  engineering: 'Engineering',
  community: 'Community',
  art: 'Art',
};

export function categoryLabel(slug) {
  if (!slug) return 'Project';
  if (CATEGORY_LABELS[slug]) return CATEGORY_LABELS[slug];
  return String(slug)
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

export function slugifyCategory(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

/** Categories for portfolio filter buttons: defaults + any used on published projects. */
export function getCategoryFilters(projects, { publishedOnly = true } = {}) {
  const set = new Set(DEFAULT_CATEGORIES);
  (projects || []).forEach(p => {
    if (publishedOnly && p.status && p.status !== 'published') return;
    if (p.category) set.add(p.category);
  });
  const ordered = DEFAULT_CATEGORIES.filter(c => set.has(c));
  [...set].filter(c => !DEFAULT_CATEGORIES.includes(c)).sort().forEach(c => ordered.push(c));
  return ordered;
}

/** All categories seen in projects (admin dropdown). */
export function getAdminCategories(projects) {
  const set = new Set(DEFAULT_CATEGORIES);
  (projects || []).forEach(p => { if (p.category) set.add(p.category); });
  const ordered = DEFAULT_CATEGORIES.filter(c => set.has(c));
  [...set].filter(c => !DEFAULT_CATEGORIES.includes(c)).sort().forEach(c => ordered.push(c));
  return ordered;
}

/** Collect unique tags from projects, timeline, and resume jobs. */
export function collectAllTags({ projects = [], timeline = [], resume = {} } = {}) {
  const tags = new Set();
  const add = arr => (arr || []).forEach(t => { if (t) tags.add(String(t).trim()); });
  projects.forEach(p => add(p.tags));
  timeline.forEach(t => add(t.tags));
  (resume.jobs || []).forEach(j => add(j.tags));
  (resume.capabilities || []).forEach(c => add(c.tags));
  return [...tags].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

export function buildResumeAiPrompt(currentPack) {
  const pack = currentPack && typeof currentPack === 'object' ? currentPack : { version: PACK_VERSION };
  const packJson = JSON.stringify(pack, null, 2);
  const categories = getAdminCategories(pack.projects || []);
  const categoryDoc = categories.map(c => `  - "${c}" → ${categoryLabel(c)}`).join('\n');

  return `You are updating Isaac E. Norris's interactive resume portfolio (portfolio site + 3D resume + printable resume). The site reads a single JSON package called resume_pack.json (version ${PACK_VERSION}).

## YOUR JOB
The user will describe new work, career changes, projects, or corrections in plain language. Produce ONE complete updated JSON package that merges their input with the current data below. Return the full package — not a diff.

## OUTPUT RULES (strict)
1. Output ONLY valid JSON. No markdown code fences, no commentary before or after.
2. Root object must include: "version": ${PACK_VERSION}, "config", "resume", "timeline", "organizations", "projects", and optionally "skills_markdown".
3. Preserve existing "config" URLs unless the user asks to change them.
4. Keep "slug" values STABLE on continuing projects — slug is how cloud-uploaded photos stay attached.
5. Project "media" arrays must be [] (empty). Photos are uploaded separately in Portfolio Admin; do not invent image URLs.
6. Use lowercase slug strings: letters, numbers, hyphens only (e.g. "space-cadets-lighting").
7. Timeline entry "id" should be unique (often "YYYY-MM-short-name"). Link organizations via timelineRef and timeline projectId (organization slug). Child projects use organizationId (organization slug).

## ORGANIZATION FIELDS (companies, ventures, employers — each item in "organizations" array)
- id or slug (required, stable — e.g. "space-cadets-lighting")
- title, subtitle, description (or summary/details)
- category (slug from list below)
- tags, website, date ("YYYY-MM")
- status: "published" or "draft"
- featured: boolean (sort boost on Companies section)
- sortOrder: number
- timelineRef: timeline entry id (optional)
- links: [{ "label", "url" }] (optional)

Organizations are companies/ventures — NOT individual products. Child work lives in "projects" with organizationId set.

## PROJECT CATEGORIES (slug → site filter label)
${categoryDoc}
You may add a new lowercase category slug if needed; it will appear as a new filter on the portfolio.

## PROJECT FIELDS (each item in "projects" array)
- id or slug (required, stable identifier; prefer slug matching id)
- title, subtitle, description (or summary/details — both accepted)
- category (slug from list above)
- tags (string array)
- role, tools (optional)
- year, date ("YYYY-MM")
- status: "published" or "draft"
- featured: boolean (sort boost in Projects grid)
- featuredDiscover: boolean (show on Discover section — curator's picks)
- sortOrder: number
- organizationId: parent organization slug (optional — omit for independent work)
- timelineRef: timeline entry id (optional)
- media: [] (always empty)
- links: [{ "label", "url" }] (optional)

## TIMELINE FIELDS (each item in "timeline" array)
- id (unique, stable)
- date ("YYYY-MM")
- title, type (e.g. Role, Venture, Milestone)
- tags, details (string)
- significance: 1–5 (optional, for 3D resume)
- projectId: organization slug (optional, links to organizations[] — career chapter)
- media: []

## RESUME OBJECT ("resume")
- profile: { name, phone, email, site, headline, summary }
- hero: { primary_domains, focus, style, chips[] } — domains/focus/style are " • "-separated strings
- mvv: { mission, vision, values[] }
- jobs: [{ title, dates, details[], tags[] }]
- education, passions, capabilities (arrays as in current data)

## SKILLS
- "skills_markdown": single string, markdown heading hierarchy (# ## ###) for the skills tree on the portfolio

## MEDIA & CLOUD ASSOCIATION
- Uploaded gallery photos live in the cloud database keyed by project slug.
- If you rename a slug, existing photos will NOT follow automatically.
- When adding new projects, use new slugs; when updating existing work, keep the same slug.

## CURRENT PACKAGE (authoritative snapshot — update and return complete JSON)
${packJson}

## AFTER YOU OUTPUT JSON
The user will paste your JSON into Portfolio Admin → Resume Data → "Paste AI JSON output" and click Apply. Run "Check for issues" first if the admin UI offers it.`;
}
