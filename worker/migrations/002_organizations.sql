-- Run once on existing D1 databases:
-- npx wrangler d1 execute isaac-portfolio --file=migrations/002_organizations.sql

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT DEFAULT '',
  description TEXT DEFAULT '',
  tags TEXT DEFAULT '[]',
  website TEXT DEFAULT '',
  date TEXT DEFAULT '',
  category TEXT DEFAULT 'venture',
  links TEXT DEFAULT '[]',
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  featured INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  timeline_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);

ALTER TABLE projects ADD COLUMN organization_id TEXT;
ALTER TABLE projects ADD COLUMN featured_discover INTEGER DEFAULT 0;
