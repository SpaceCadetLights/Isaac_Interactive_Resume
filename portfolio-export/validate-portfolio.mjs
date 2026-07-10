#!/usr/bin/env node
/**
 * Validates generated/resume_pack.candidate.json and writes generation-report.md
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CANDIDATE_PATH = join(ROOT, 'generated', 'resume_pack.candidate.json');
const KNOWN_SLUGS_PATH = join(__dirname, 'KNOWN_SLUGS.json');
const SOURCE_PATH = join(__dirname, 'public-content-source.json');
const LIVE_PACK_PATH = join(ROOT, 'data', 'resume_pack.json');
const REPORT_PATH = join(ROOT, 'generated', 'generation-report.md');

const REQUIRED_ROOT_KEYS = ['version', 'config', 'resume', 'organizations', 'projects', 'timeline'];
const VALID_STATUSES = new Set(['published', 'draft']);
const DATE_RE = /^\d{4}-\d{2}$/;
const FORBIDDEN_PATTERNS = [
  { name: 'phone', re: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/ },
  { name: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/ },
  { name: 'health-keyword', re: /\b(cancer diagnosis|medical record|prescription)\b/i },
  { name: 'financial-keyword', re: /\b(bank account|routing number|credit card)\b/i },
];
const MAX_FEATURED_DISCOVER = 12;
const FORBIDDEN_FIELDS = ['password', 'apiKey', 'secret', 'privateKey', 'ssn'];

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function collectStrings(obj, out = []) {
  if (obj == null) return out;
  if (typeof obj === 'string') {
    out.push(obj);
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach(v => collectStrings(v, out));
    return out;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (FORBIDDEN_FIELDS.includes(k)) {
        out.push(`__FORBIDDEN_FIELD__:${k}`);
      }
      collectStrings(v, out);
    }
  }
  return out;
}

function validate(pack, knownSlugs, source, livePack) {
  const errors = [];
  const warnings = [];

  if (pack.version !== 2) errors.push(`Root version must be 2 (got ${pack.version})`);

  for (const key of REQUIRED_ROOT_KEYS) {
    if (!(key in pack)) errors.push(`Missing required root key: ${key}`);
  }

  if (!pack.config?.apiBaseUrl) errors.push('config.apiBaseUrl is missing');
  if (!pack.config?.mediaBaseUrl) errors.push('config.mediaBaseUrl is missing');

  if (livePack?.config) {
    if (pack.config.apiBaseUrl !== livePack.config.apiBaseUrl) {
      errors.push('config.apiBaseUrl changed from live package');
    }
    if (pack.config.mediaBaseUrl !== livePack.config.mediaBaseUrl) {
      errors.push('config.mediaBaseUrl changed from live package');
    }
  }

  const orgSlugs = new Set();
  for (const org of pack.organizations || []) {
    if (orgSlugs.has(org.slug)) errors.push(`Duplicate organization slug: ${org.slug}`);
    orgSlugs.add(org.slug);
    if (!VALID_STATUSES.has(org.status)) errors.push(`Invalid org status: ${org.slug} → ${org.status}`);
    if (org.date && !DATE_RE.test(org.date)) errors.push(`Invalid org date: ${org.slug} → ${org.date}`);
    if (knownSlugs.organizations?.includes(org.slug)) {
      if (org.id !== org.slug) warnings.push(`Known org ${org.slug} has id !== slug`);
    }
  }

  const projectSlugs = new Set();
  let featuredCount = 0;
  for (const proj of pack.projects || []) {
    if (projectSlugs.has(proj.slug)) errors.push(`Duplicate project slug: ${proj.slug}`);
    projectSlugs.add(proj.slug);
    if (!VALID_STATUSES.has(proj.status)) errors.push(`Invalid project status: ${proj.slug} → ${proj.status}`);
    if (proj.date && !DATE_RE.test(proj.date)) errors.push(`Invalid project date: ${proj.slug} → ${proj.date}`);
    if (proj.organizationId && !orgSlugs.has(proj.organizationId)) {
      errors.push(`project.organizationId unresolved: ${proj.slug} → ${proj.organizationId}`);
    }
    if (!Array.isArray(proj.media) || proj.media.length > 0) {
      errors.push(`project.media must be []: ${proj.slug}`);
    }
    if (proj.featuredDiscover) featuredCount++;
    if (proj.entryKind === 'custom' && !proj.entryKindLabel) {
      errors.push(`Custom entry missing entryKindLabel: ${proj.slug}`);
    }
    if (knownSlugs.projects?.includes(proj.slug)) {
      if (proj.id !== proj.slug) warnings.push(`Known project ${proj.slug} has id !== slug`);
    }
  }

  if (featuredCount > MAX_FEATURED_DISCOVER) {
    warnings.push(`featuredDiscover count (${featuredCount}) exceeds recommended max (${MAX_FEATURED_DISCOVER})`);
  }

  const timelineIds = new Set();
  for (const entry of pack.timeline || []) {
    if (timelineIds.has(entry.id)) errors.push(`Duplicate timeline id: ${entry.id}`);
    timelineIds.add(entry.id);
    if (entry.date && !DATE_RE.test(entry.date)) errors.push(`Invalid timeline date: ${entry.id} → ${entry.date}`);
    if (entry.projectId && !orgSlugs.has(entry.projectId)) {
      errors.push(`timeline.projectId unresolved: ${entry.id} → ${entry.projectId}`);
    }
    if (!Array.isArray(entry.media) || entry.media.length > 0) {
      errors.push(`timeline.media must be []: ${entry.id}`);
    }
  }

  for (const org of pack.organizations || []) {
    if (org.timelineRef && !timelineIds.has(org.timelineRef)) {
      errors.push(`organization.timelineRef unresolved: ${org.slug} → ${org.timelineRef}`);
    }
  }

  for (const proj of pack.projects || []) {
    if (proj.timelineRef && !timelineIds.has(proj.timelineRef)) {
      errors.push(`project.timelineRef unresolved: ${proj.slug} → ${proj.timelineRef}`);
    }
  }

  // Known slug preservation — slug must still exist (may have enriched content)
  for (const slug of knownSlugs.organizations || []) {
    if (!orgSlugs.has(slug)) errors.push(`Known organization slug missing: ${slug}`);
  }
  for (const slug of knownSlugs.projects || []) {
    if (!projectSlugs.has(slug)) errors.push(`Known project slug missing: ${slug}`);
  }

  // Privacy scan
  const approved = new Set(source.editorial?.approvedPublicFields || []);
  const allText = collectStrings(pack).join('\n');

  if (!approved.has('phone')) {
    for (const { name, re } of FORBIDDEN_PATTERNS) {
      if (name === 'phone' && re.test(allText)) {
        warnings.push('Phone number pattern detected but phone is not in approvedPublicFields');
      }
    }
  }

  for (const { name, re } of FORBIDDEN_PATTERNS) {
    if (name === 'phone') continue;
    if (re.test(allText)) warnings.push(`Possible sensitive content (${name}) detected in package text`);
  }

  if (allText.includes('__FORBIDDEN_FIELD__')) {
    errors.push('Forbidden credential-like fields detected in package');
  }

  // New vs live comparison
  const liveProjectSlugs = new Set((livePack.projects || []).map(p => p.slug));
  const newProjects = [...projectSlugs].filter(s => !liveProjectSlugs.has(s));
  const liveOrgSlugs = new Set((livePack.organizations || []).map(o => o.slug));
  const newOrgs = [...orgSlugs].filter(s => !liveOrgSlugs.has(s));

  return { errors, warnings, newProjects, newOrgs, featuredCount, orgSlugs, projectSlugs, timelineIds };
}

function buildReport({ errors, warnings, pack, source, knownSlugs, newProjects, newOrgs, featuredCount }) {
  const featured = (pack.projects || []).filter(p => p.featuredDiscover).map(p => p.slug);
  const drafts = (pack.projects || []).filter(p => p.status === 'draft').map(p => p.slug);
  const lines = [
    '# Portfolio Generation Report',
    '',
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
    '',
    '## Summary',
    '',
    `- Organizations: ${pack.organizations.length}`,
    `- Projects: ${pack.projects.length}`,
    `- Timeline entries: ${pack.timeline.length}`,
    `- Featured discover: ${featuredCount}`,
    `- Validation errors: ${errors.length}`,
    `- Validation warnings: ${warnings.length}`,
    '',
    '## Organizations generated',
    '',
    ...(pack.organizations || []).map(o => `- \`${o.slug}\` — ${o.title} (${o.status})`),
    '',
    '## Projects generated',
    '',
    ...(pack.projects || []).map(p => `- \`${p.slug}\` — ${p.title} (${p.status}${p.featuredDiscover ? ', featured' : ''})`),
    '',
    '## Timeline entries generated',
    '',
    ...(pack.timeline || []).map(t => `- \`${t.id}\` — ${t.title} (${t.date})`),
    '',
    '## Highlights selected',
    '',
    ...featured.map(s => `- \`${s}\``),
    '',
    '## Existing slugs preserved',
    '',
    '### Organizations',
    ...(knownSlugs.organizations || []).map(s => `- \`${s}\``),
    '',
    '### Projects',
    ...(knownSlugs.projects || []).map(s => `- \`${s}\``),
    '',
    '### Timeline',
    ...(knownSlugs.timeline || []).map(s => `- \`${s}\``),
    '',
    '## New entries (not in live package)',
    '',
    `### New organizations (${newOrgs.length})`,
    ...(newOrgs.length ? newOrgs.map(s => `- \`${s}\``) : ['- None']),
    '',
    `### New projects (${newProjects.length})`,
    ...(newProjects.length ? newProjects.map(s => `- \`${s}\``) : ['- None']),
    '',
    '## Legacy entries requiring attention',
    '',
    '- `experiments` — retained from live package; legacy R&D bucket',
    '- `dimension-3-fabrication` — legacy slug for Multi-Machine; richer `multi-machine` entry added',
    '- `dimension-3` — org slug preserved (not renamed to dimension-3-fabrication)',
    '- `nebula-app` — featuredDiscover removed; parent `nebula` is featured instead',
    '',
    '## Draft projects',
    '',
    ...(drafts.length ? drafts.map(s => `- \`${s}\``) : ['- None']),
    '',
    '## Dates that remain approximate',
    '',
    ...(source.editorial?.dateWarnings || []).map(w => `- ${w}`),
    '',
    '## Claims needing verification',
    '',
    ...(source.editorial?.claimsNeedingVerification || []).map(c => `- ${c}`),
    '',
    '## Content excluded for privacy',
    '',
    ...(source.editorial?.privateExclusions || []).map(e => `- ${e}`),
    '',
    '## Validation errors',
    '',
    ...(errors.length ? errors.map(e => `- ❌ ${e}`) : ['- None']),
    '',
    '## Validation warnings',
    '',
    ...(warnings.length ? warnings.map(w => `- ⚠️ ${w}`) : ['- None']),
    '',
    '## Recommended manual review steps',
    '',
    '1. Read `portfolio-export/public-content-source.json` for editorial intent',
    '2. Compare `generated/resume_pack.candidate.json` with `data/resume_pack.json`',
    '3. Verify approximate dates and placeholder months in dateWarnings',
    '4. Confirm WLED and Gorilla Machines claims before publishing drafts',
    '5. Paste candidate JSON into Portfolio Admin → Resume Data → Check for issues → Apply',
    '6. Upload photos per project slug in Admin → Projects → Edit → Media',
    '7. Do **not** apply until satisfied with privacy and accuracy review',
    '',
  ];

  return lines.join('\n');
}

function main() {
  if (!existsSync(CANDIDATE_PATH)) {
    console.error('Candidate not found. Run: npm run portfolio:generate');
    process.exit(1);
  }

  const pack = loadJson(CANDIDATE_PATH);
  const knownSlugs = loadJson(KNOWN_SLUGS_PATH);
  const source = loadJson(SOURCE_PATH);
  const livePack = existsSync(LIVE_PACK_PATH) ? loadJson(LIVE_PACK_PATH) : null;

  const result = validate(pack, knownSlugs, source, livePack);
  const report = buildReport({ ...result, pack, source, knownSlugs });

  writeFileSync(REPORT_PATH, report, 'utf8');

  console.log('Validation report:', REPORT_PATH);
  console.log(`  Errors: ${result.errors.length}`);
  console.log(`  Warnings: ${result.warnings.length}`);

  if (result.errors.length) {
    result.errors.forEach(e => console.error(`  ❌ ${e}`));
    process.exit(1);
  }

  result.warnings.forEach(w => console.warn(`  ⚠️ ${w}`));
  console.log('Validation passed.');
}

main();
