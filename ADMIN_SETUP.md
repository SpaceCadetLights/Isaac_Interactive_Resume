# Portfolio Admin — setup checklist

Do these steps **once** after pulling the latest code. The public site keeps working from static JSON until you finish.

## What you get

| Piece | URL / location |
|-------|----------------|
| Public portfolio | `https://resume.spacecadetslighting.com/portfolio/` |
| Admin UI | `https://resume.spacecadetslighting.com/admin/` |
| API (Worker) | `https://api.resume.spacecadetslighting.com` (recommended) |
| Media (R2) | `https://media.resume.spacecadetslighting.com` |

---

## 1. Cloudflare R2 (media storage)

1. [Cloudflare dashboard](https://dash.cloudflare.com) → **R2** → **Create bucket**
2. Bucket name: **`isaac-media`** (must match `worker/wrangler.toml`)
3. **Settings → Custom domains** → add **`media.resume.spacecadetslighting.com`**
4. Confirm a test file is reachable:  
   `https://media.resume.spacecadetslighting.com/test.txt`

---

## 2. Cloudflare D1 (project metadata)

1. Dashboard → **Workers & Pages** → **D1** → **Create database**
2. Name: **`isaac-portfolio`**
3. Copy the **database ID**
4. Open `worker/wrangler.toml` and replace:
   ```toml
   database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"
   ```
   with your real ID.

5. From the repo root, run the schema:

```bash
cd worker
npm install
npx wrangler d1 execute isaac-portfolio --file=schema.sql
```

---

## 3. Deploy the Worker API

```bash
cd worker
npx wrangler secret put ADMIN_PASSWORD
# Enter a strong password (do not share in chat or commit)

npx wrangler secret put SESSION_SECRET
# Enter a long random string (e.g. openssl rand -hex 32)

npx wrangler deploy
```

Note the deploy URL (e.g. `https://isaac-portfolio-api.<account>.workers.dev`).

### Recommended: custom API domain

In Cloudflare → **Workers** → your worker → **Settings → Domains & Routes**:

- Add **`api.resume.spacecadetslighting.com`**

Using a subdomain on your own domain keeps admin login cookies reliable. A bare `*.workers.dev` URL also works but is less ideal for cross-site auth.

---

## 4. Wire the site to the API

Edit **`data/resume_pack.json`**:

```json
"config": {
  "mediaBaseUrl": "https://media.resume.spacecadetslighting.com",
  "apiBaseUrl": "https://api.resume.spacecadetslighting.com"
}
```

Edit **`admin/config.json`** (same API URL):

```json
{
  "apiBaseUrl": "https://api.resume.spacecadetslighting.com"
}
```

Commit and push to GitHub Pages (or your usual deploy flow).

---

## 5. CORS origins (if needed)

`worker/wrangler.toml` already allows:

- `https://resume.spacecadetslighting.com`
- `http://localhost:8000`

If you use another preview URL, add it to `ALLOWED_ORIGINS` (comma-separated) and redeploy.

---

## 6. Use the admin

1. Open **`https://resume.spacecadetslighting.com/admin/`**
2. Sign in with the password you set in step 3
3. **New project** → fill title, slug, description, set status to **published** when ready
4. **Upload** images/video (stored in R2 under `portfolio/projects/{slug}/…`)
5. Reload the public portfolio — published projects load from the API automatically

### Migrating stub projects

The five placeholder projects in `resume_pack.json` are **not** auto-imported. In admin, recreate them (matching slugs like `space-cadets-lighting` helps timeline links keep working). Set **timeline ref** if you add that field later; timeline entries in JSON still reference projects by **slug**.

---

## 7. Local dev

```bash
# Terminal 1 — static site
python3 -m http.server 8000

# Terminal 2 — Worker API
cd worker && npx wrangler dev
```

- Portfolio: `http://localhost:8000/portfolio/`
- Admin: `http://localhost:8000/admin/` (auto-targets `http://localhost:8787` when `admin/config.json` apiBaseUrl is empty)

For local API testing, you can set `admin/config.json` to `http://localhost:8787`.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Admin says “API not configured” | Set `apiBaseUrl` in `admin/config.json` and redeploy static site |
| Login fails / 401 | Check `ADMIN_PASSWORD` secret; redeploy after setting secrets |
| Upload fails | Confirm R2 bucket name `isaac-media` and D1 database ID in `wrangler.toml` |
| Images 404 on portfolio | Confirm R2 custom domain and `mediaBaseUrl` in config |
| Portfolio still shows JSON stubs | Set `apiBaseUrl` in `resume_pack.json`; publish at least one project in admin |
| CORS error in browser console | Add your site origin to `ALLOWED_ORIGINS` and `wrangler deploy` |

---

## Cost note

At solo scale (~20 GB media, light admin traffic), R2 + Worker + D1 typically stay within free/low tiers. Media never goes in git.
