#!/usr/bin/env node
/**
 * Scan a local folder and emit media[] JSON for resume_pack.json.
 * Usage: node scripts/build-media-manifest.js ./my-photos space-cadets-lighting
 */
const fs = require('fs');
const path = require('path');

const [dir, projectId] = process.argv.slice(2);
if (!dir || !projectId) {
  console.error('Usage: node scripts/build-media-manifest.js <folder> <project-id>');
  process.exit(1);
}

const abs = path.resolve(dir);
if (!fs.existsSync(abs)) {
  console.error('Folder not found:', abs);
  process.exit(1);
}

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov']);

function captionFromName(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

const items = fs.readdirSync(abs).sort().flatMap(name => {
  const ext = path.extname(name).toLowerCase();
  const rel = `${projectId}/${name}`;
  if (IMAGE_EXT.has(ext)) {
    return [{ type: 'image', src: rel, caption: captionFromName(name) }];
  }
  if (VIDEO_EXT.has(ext)) {
    const posterBase = path.basename(name, ext);
    const poster = `${projectId}/${posterBase}-thumb.jpg`;
    return [{ type: 'video', src: rel, poster, caption: captionFromName(name) }];
  }
  return [];
});

console.log(JSON.stringify(items, null, 2));
