# Portfolio Field Mapping

## Data flow

```
Isaacs-Life-Archive (Markdown, private, read-only)
        ↓ human/AI curation
public-content-source.json (editable intermediate)
        ↓ generate-portfolio.mjs (deterministic)
generated/resume_pack.candidate.json (version 2 package)
        ↓ validate-portfolio.mjs
generated/generation-report.md
        ↓ manual review
Portfolio Admin → Resume Data → Apply
```

## Source → package mapping

| public-content-source | resume_pack v2 |
|----------------------|----------------|
| `profile` | `resume.profile` |
| `hero` | `resume.hero` |
| `mvv` | `resume.mvv` |
| `jobs` | `resume.jobs` |
| `education` | `resume.education` |
| `passions` | `resume.passions` |
| `capabilities` | `resume.capabilities` |
| `organizations[]` | `organizations[]` |
| `projects[]` | `projects[]` |
| `timeline[]` | `timeline[]` |
| `skills` (object tree) | `skills_markdown` (rendered markdown) |
| `editorial.featuredDiscoverSlugs` | `projects[].featuredDiscover` |

## Relationship rules

| Field | Points to |
|-------|-----------|
| `project.organizationId` | `organizations[].slug` |
| `timeline.projectId` | `organizations[].slug` (not child project slug) |
| `organization.timelineRef` | `timeline[].id` |
| `project.timelineRef` | `timeline[].id` (optional) |

## Site surface mapping

| Portfolio section | Package fields |
|-------------------|----------------|
| Hero | `resume.profile`, `resume.hero` |
| About | `resume.mvv` + hero chips |
| Explore My Highlights | `projects` where `featuredDiscover: true` |
| Library | all published `projects` |
| Timeline | `timeline[]` |
| Companies & Ventures | `organizations[]` + child projects via `organizationId` |
| Education | `resume.education[]` |
| Skills Map | `skills_markdown` |
| Passions / Manufacturing | `resume.passions`, `resume.capabilities` |

## Migration decisions (Phase 1)

| Entry | Decision |
|-------|----------|
| `dimension-3` (org) | **Preserved** — existing slug, not renamed to `dimension-3-fabrication` |
| `dimension-3-fabrication` (project) | **Preserved** — maps to Multi-Machine; new slug `multi-machine` added as richer entry |
| `experiments` | **Retained** as legacy published project |
| `nebula-app` | **Preserved** slug; `featuredDiscover` removed per Phase 1 curation |
| `mojo-3d-print-lab` | **Preserved** — represents Mojo Coworking lab role |
