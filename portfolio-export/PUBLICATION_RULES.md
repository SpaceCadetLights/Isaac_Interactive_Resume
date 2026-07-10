# Publication Rules

The Life Archive (`Isaacs-Life-Archive`) is **private canonical knowledge**. The portfolio (`Isaac_Interactive_Resume`) is a **curated public export**.

## Never publish automatically

This adapter writes `generated/resume_pack.candidate.json` only. Isaac reviews and manually imports through Portfolio Admin → Resume Data → Check for issues → Apply.

## Exclude from public export

- Partner information and personal health context
- Financial details, revenue, burn rate, or business anxiety
- Confidential plans, licensing terms, or unreleased strategy
- Internal intellectual property (e.g. detailed control algorithms)
- Credentials, passwords, API keys, private addresses
- Unverified claims without editorial review
- Attribution from unrelated lifestyle or research material

## Slug stability

- Never rename slugs listed in `KNOWN_SLUGS.json`
- New entries use lowercase hyphenated slugs
- Media is joined by slug in R2 — renaming breaks galleries

## Media

- Every `media` array in generated output must be `[]`
- Never invent image URLs
- Photos are uploaded separately in Portfolio Admin after import

## Dates

- Do not fabricate exact dates
- Use `YYYY-MM` when month is known
- Use `YYYY-01` only when a month is required but unknown — record in `editorial.dateWarnings`
- Prefer `draft` status when dates are too uncertain for public display

## Writing tone

- First-person-neutral or professional third-person
- Concrete, evidence-based, human
- No exaggerated marketing language
- Clear about Isaac's role and collaborator contributions
- Present as integrator across domains, not master of everything

## Config preservation

- Always preserve `config.apiBaseUrl` and `config.mediaBaseUrl` from the current live package
