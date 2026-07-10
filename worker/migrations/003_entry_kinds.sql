-- Run once on existing D1 databases:
-- npx wrangler d1 execute isaac-portfolio --file=migrations/003_entry_kinds.sql

ALTER TABLE projects ADD COLUMN entry_kind TEXT DEFAULT 'project';
ALTER TABLE projects ADD COLUMN entry_kind_label TEXT DEFAULT '';
