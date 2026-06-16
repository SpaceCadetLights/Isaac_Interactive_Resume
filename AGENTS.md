# Agent instructions

## Project overview

Static portfolio and resume site with three surfaces sharing one data file (`data/resume_pack.json`):

| Surface | Path |
|---------|------|
| Portfolio | `/portfolio/` |
| 3D Resume | `/3d-resume/` |
| Standard Resume | `/interactive_resume_spacecadets_v6_singlefile.html` |

Media assets live on Cloudflare R2 (not in git). See `data/media/R2_SETUP.md`.

## Local / cloud development

```bash
./scripts/dev-server.sh
```

Preview URLs (port 8000 by default):

- http://localhost:8000/portfolio/
- http://localhost:8000/3d-resume/
- http://localhost:8000/interactive_resume_spacecadets_v6_singlefile.html

## Cursor Cloud specific instructions

**Primary development happens in the Cursor Cloud Agent environment**, not on a local machine. The cloud VM is the source of truth during active work.

### Environment

- Config: `.cursor/environment.json`
- Bootstrap: `./scripts/cloud-install.sh` (runs automatically on agent startup)
- Dev server: `./scripts/dev-server.sh` (also started automatically in a tmux terminal)

### Git sync workflow

After each **stable, working change**, commit and push to GitHub so the repo stays in sync:

1. Work on a feature branch: `cursor/<descriptive-name>-5095`
2. Test changes with the dev server before committing
3. Commit with a clear message describing what changed and why
4. Push immediately: `git push -u origin <branch>`
5. Open or update a PR against `main`

Quick helper:

```bash
./scripts/sync-stable.sh "Describe the stable change"
```

**Do not** leave completed work uncommitted on the cloud VM. Push after every stable checkpoint, not only at the end of a session.

### Branch and PR conventions

- Branch prefix: `cursor/`
- Branch suffix: `-5095`
- Base branch: `main`
- Create or update the PR at the end of each turn when changes were made

### What to avoid committing

- Image/video files (use R2 instead)
- Secrets, API keys, or `.env` files
- Large generated artifacts

### Smoke checks before pushing

```bash
./scripts/cloud-install.sh          # validates JSON + tools
python3 -c "import json; json.load(open('data/resume_pack.json'))"
```

If the dev server is running, spot-check the surface you changed in the browser.
