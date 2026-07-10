# Portfolio Export Adapter

Safe, reviewable pipeline from the private **Isaacs-Life-Archive** to a public **resume_pack** candidate for the interactive portfolio.

## Important

1. The Life Archive is **private** canonical knowledge — read-only for this adapter.
2. `public-content-source.json` is the **curated** intermediate — edit this by hand.
3. `generate-portfolio.mjs` **deterministically** transforms source → candidate package.
4. Isaac **manually reviews** `generated/resume_pack.candidate.json`.
5. Import through **Portfolio Admin → Resume Data → Check for issues → Apply**.
6. **Photos are uploaded separately** per project slug in Admin (R2, keyed by slug).
7. **Existing slugs must remain stable** — see `KNOWN_SLUGS.json`.
8. This adapter **does not publish automatically** to Cloudflare.

## Commands

```bash
npm run portfolio:generate   # source → generated/resume_pack.candidate.json
npm run portfolio:validate   # validate + write generated/generation-report.md
npm run portfolio:build    # generate then validate
```

## Workflow

```
Isaacs-Life-Archive (Markdown)
        ↓ selective curation (human / Cursor)
public-content-source.json
        ↓ npm run portfolio:generate
generated/resume_pack.candidate.json
        ↓ npm run portfolio:validate
generated/generation-report.md
        ↓ manual review
Portfolio Admin → Apply
        ↓
Upload media per slug in Admin
```

## Files

| File | Purpose |
|------|---------|
| `public-content-source.json` | Human-editable curated public content |
| `KNOWN_SLUGS.json` | Slugs that must not be renamed |
| `generate-portfolio.mjs` | Deterministic transformer |
| `validate-portfolio.mjs` | Schema, relationship, and privacy checks |
| `PUBLICATION_RULES.md` | What must never be published |
| `PORTFOLIO_MAPPING.md` | Field mapping and migration decisions |
| `FEATURED_SELECTION.md` | Highlights curation rationale |

## Editing content

1. Update archive Markdown (in Life Archive repo) when facts change.
2. Reflect approved public facts in `public-content-source.json`.
3. Run `npm run portfolio:build`.
4. Read `generated/generation-report.md` for warnings and review items.
5. Import candidate JSON only after review.

## Slug stability

If a slug in `KNOWN_SLUGS.json` is renamed, R2 gallery images keyed to the old slug will not follow. Add new slugs for new work; preserve existing ones.
