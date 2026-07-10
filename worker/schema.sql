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

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT DEFAULT '',
  description TEXT DEFAULT '',
  tags TEXT DEFAULT '[]',
  role TEXT DEFAULT '',
  tools TEXT DEFAULT '[]',
  year INTEGER,
  date TEXT DEFAULT '',
  category TEXT DEFAULT 'engineering',
  links TEXT DEFAULT '[]',
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  featured INTEGER DEFAULT 0,
  featured_discover INTEGER DEFAULT 0,
  entry_kind TEXT DEFAULT 'project',
  entry_kind_label TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  organization_id TEXT,
  timeline_ref TEXT,
  hero_media_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  public_url TEXT NOT NULL,
  file_type TEXT NOT NULL,
  mime_type TEXT DEFAULT '',
  alt_text TEXT DEFAULT '',
  caption TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  slot TEXT DEFAULT 'gallery',
  bytes INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_media_project ON media_assets(project_id);

CREATE TABLE IF NOT EXISTS site_pack (
  id TEXT PRIMARY KEY DEFAULT 'main',
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
