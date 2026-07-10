# Media Folder Conventions

Photos and videos are hosted on **Cloudflare R2** (see [R2_SETUP.md](R2_SETUP.md)), not in git — except the bundled hero portrait at `isaac-headshot.png` (served from this folder for GitHub Pages).

## Folder Structure (R2 bucket)

```
space-cadets-lighting/
  hero.jpg
  photo-001.jpg
  demo.mp4
  demo-thumb.jpg
```

**Slug naming**: lowercase, hyphens — match `projects[].slug` in `resume_pack.json`.

## Referencing Media in `resume_pack.json`

Inside `projects[].media` (preferred) or timeline `media[]`:

```json
"media": [
  {
    "type": "image",
    "src": "space-cadets-lighting/photo1.jpg",
    "caption": "Optional caption",
    "tags": ["LED", "install"]
  },
  {
    "type": "video",
    "src": "space-cadets-lighting/demo.mp4",
    "poster": "space-cadets-lighting/demo-thumb.jpg",
    "caption": "Optional caption"
  },
  {
    "type": "link",
    "url": "https://spacecadetslighting.com",
    "label": "View website"
  }
]
```

Paths are relative to `config.mediaBaseUrl` when set; otherwise resolved from site root.

### Media Types

| type    | required fields      | optional fields        |
|---------|----------------------|------------------------|
| `image` | `src`                | `caption`, `tags`      |
| `video` | `src`                | `poster`, `caption`, `tags` |
| `link`  | `url`, `label`       | —                      |

## Bulk manifest

```bash
node scripts/build-media-manifest.js /path/to/local/folder space-cadets-lighting
```

Paste output into `projects[].media` in `resume_pack.json`.

## File Format Recommendations

- **Photos**: JPEG 80–90%, max 1920px long edge
- **Video**: MP4 H.264, under 2 min, include `poster`
- **File names**: lowercase, hyphens only
