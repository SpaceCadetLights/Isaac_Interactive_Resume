# Isaac Interactive Resume & Portfolio

Three linked experiences, one shared data file:

| Surface | Path | Purpose |
|---------|------|---------|
| **Portfolio** | `/portfolio/` | Media-first portfolio (default) |
| **3D Resume** | `/3d-resume/` | Original interactive WebGL resume |
| **Standard Resume** | `/interactive_resume_spacecadets_v6_singlefile.html` | Printable / PDF export |

Canonical data: [`data/resume_pack.json`](data/resume_pack.json)

## Local development

```bash
cd "/Users/spacecadet/Software Dev/Isaac_Interactive_Resume"
python3 -m http.server 8000
```

- Portfolio: http://localhost:8000/portfolio/
- 3D Resume: http://localhost:8000/3d-resume/
- Standard: http://localhost:8000/interactive_resume_spacecadets_v6_singlefile.html

## GitHub Pages

1. Repo **Settings → Pages** → Deploy from branch `main`, folder `/ (root)`.
2. Live URLs (replace username if needed):
   - `https://spacecadetlights.github.io/Isaac_Interactive_Resume/portfolio/`
   - `https://spacecadetlights.github.io/Isaac_Interactive_Resume/3d-resume/`
   - `https://spacecadetlights.github.io/Isaac_Interactive_Resume/data/resume_pack.json`

Data paths auto-detect GitHub Pages vs local dev via [`shared/site-paths.js`](shared/site-paths.js).

## Cloudflare R2 (media CDN)

Photos and videos live on R2, not in git. See [`data/media/R2_SETUP.md`](data/media/R2_SETUP.md).

After R2 is configured, set `config.mediaBaseUrl` in `resume_pack.json`:

```json
"config": {
  "mediaBaseUrl": "https://media.YOUR_SUBDOMAIN.com"
}
```

## Add project media

1. Upload folder to R2 (e.g. `space-cadets-lighting/`)
2. Add `projects[]` entry in `resume_pack.json`
3. `git push` — do not commit image files

Bulk manifest helper: `node scripts/build-media-manifest.js <folder> <project-id>`
