# Cloudflare R2 Setup (manual — one time)

Follow these steps when you are ready to host photos and video off git.

## 1. Create bucket

1. [Cloudflare dashboard](https://dash.cloudflare.com) → **R2 Object Storage**
2. **Create bucket** → name: `isaac-portfolio-media`
3. Create folder: `space-cadets-lighting/`

## 2. Public access

**Settings → Custom Domains** → connect e.g. `media.resume.spacecadetslighting.com`

Or temporarily enable **r2.dev** public URL on the bucket.

## 3. Upload media

Use the dashboard or Cyberduck (R2 API token with read/write).

## 4. Wire into site

In `data/resume_pack.json`:

```json
"config": {
  "mediaBaseUrl": "https://media.resume.spacecadetslighting.com"
}
```

Media paths in JSON stay relative: `"src": "space-cadets-lighting/hero.jpg"`

## 5. Verify

Open in browser: `https://YOUR_MEDIA_URL/space-cadets-lighting/hero.jpg`

Then reload portfolio and open the project gallery.
