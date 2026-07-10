#!/usr/bin/env node
/**
 * Deterministic transformer: public-content-source.json → resume_pack.candidate.json
 * Does not call external AI APIs. Preserves config URLs from current live package.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SOURCE_PATH = join(__dirname, 'public-content-source.json');
const KNOWN_SLUGS_PATH = join(__dirname, 'KNOWN_SLUGS.json');
const LIVE_PACK_PATH = join(ROOT, 'data', 'resume_pack.json');
const OUTPUT_PATH = join(ROOT, 'generated', 'resume_pack.candidate.json');

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function renderSkillsMarkdown(skillsTree) {
  const lines = ['# Skills & Capabilities', ''];
  for (const [h1, sections] of Object.entries(skillsTree)) {
    lines.push(`# ${h1}`, '');
    for (const [h2, items] of Object.entries(sections)) {
      lines.push(`## ${h2}`, '');
      for (const item of items) {
        lines.push(`- ${item}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n').trimEnd() + '\n';
}

function buildProject(entry, featuredSlugs) {
  const project = {
    id: entry.slug,
    slug: entry.slug,
    title: entry.title,
    subtitle: entry.subtitle || '',
    category: entry.category || 'engineering',
    featuredDiscover: featuredSlugs.includes(entry.slug),
    featured: Boolean(entry.featured),
    status: entry.status || 'published',
    tags: entry.tags || [],
    date: entry.date,
    summary: entry.summary || '',
    details: entry.details || entry.summary || '',
    media: [],
    links: entry.links || [],
    entryKind: entry.entryKind || 'project',
  };

  if (entry.organizationId) project.organizationId = entry.organizationId;
  if (entry.timelineRef) project.timelineRef = entry.timelineRef;
  if (entry.role) project.role = entry.role;
  if (entry.tools) project.tools = entry.tools;
  if (entry.sortOrder != null) project.sortOrder = entry.sortOrder;
  if (entry.entryKind === 'custom' && entry.entryKindLabel) {
    project.entryKindLabel = entry.entryKindLabel;
  }

  return project;
}

function buildOrganization(entry) {
  const org = {
    id: entry.slug,
    slug: entry.slug,
    title: entry.title,
    subtitle: entry.subtitle || '',
    category: entry.category || 'engineering',
    featured: Boolean(entry.featured),
    status: entry.status || 'published',
    tags: entry.tags || [],
    date: entry.date,
    description: entry.description || '',
    timelineRef: entry.timelineRef,
  };

  if (entry.website) org.website = entry.website;
  if (entry.links?.length) org.links = entry.links;
  if (entry.sortOrder != null) org.sortOrder = entry.sortOrder;

  return org;
}

function buildTimelineEntry(entry) {
  const tl = {
    id: entry.id,
    date: entry.date,
    title: entry.title,
    type: entry.type || 'Milestone',
    tags: entry.tags || [],
    details: entry.details || '',
    media: [],
  };

  if (entry.projectId) tl.projectId = entry.projectId;
  if (entry.significance != null) tl.significance = entry.significance;

  return tl;
}

function main() {
  const source = loadJson(SOURCE_PATH);
  const livePack = loadJson(LIVE_PACK_PATH);
  const featuredSlugs = source.editorial?.featuredDiscoverSlugs || [];

  const pack = {
    version: 2,
    config: {
      mediaBaseUrl: livePack.config.mediaBaseUrl,
      apiBaseUrl: livePack.config.apiBaseUrl,
    },
    resume: {
      profile: { ...source.profile },
      hero: { ...source.hero },
      mvv: { ...source.mvv },
      jobs: source.jobs || [],
      education: source.education || [],
      passions: source.passions || [],
      capabilities: source.capabilities || [],
    },
    organizations: (source.organizations || []).map(buildOrganization),
    projects: (source.projects || []).map(p => buildProject(p, featuredSlugs)),
    timeline: (source.timeline || []).map(buildTimelineEntry),
    skills_markdown: renderSkillsMarkdown(source.skills || {}),
  };

  // Approved optional profile fields (e.g. phone)
  const approved = source.editorial?.approvedPublicFields || [];
  if (approved.includes('phone') && source.profile?.phone) {
    pack.resume.profile.phone = source.profile.phone;
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(pack, null, 2) + '\n', 'utf8');

  const stats = {
    organizations: pack.organizations.length,
    projects: pack.projects.length,
    timeline: pack.timeline.length,
    featuredDiscover: pack.projects.filter(p => p.featuredDiscover).length,
  };

  console.log('Generated:', OUTPUT_PATH);
  console.log(`  Organizations: ${stats.organizations}`);
  console.log(`  Projects: ${stats.projects}`);
  console.log(`  Timeline: ${stats.timeline}`);
  console.log(`  Featured discover: ${stats.featuredDiscover}`);
}

main();
