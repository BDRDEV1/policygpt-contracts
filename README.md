# Shared Contracts — single source of truth

These JSON Schema files are the **frozen payload contracts** that cross PolicyGPT's tier boundaries (plugin ↔ coordinator ↔ rater). They are authored here as the **single source of truth** (architecture plan §23.1) and **must NOT be hand-copied** into the build repos. Each repo (`policygpt-plugin`, `policygpt-coordinator`, `policygpt-rater`) **vendors** these files (git submodule, npm package, or a sync script with a checksum check) and validates against the *same* files — that is the structural guard against the two builders drifting into incompatible payloads.

## Files
- **`quote-job.schema.json`** — Coordinator → Rater job payload (Appendix A). `business_type` is **required** to enforce the known plugin drop-bug fix (§2.1).
- **`completion.schema.json`** — Rater → Coordinator completion payload (Appendix B, v1.1). Artifacts are **pointers** (`storage_path` + `checksum` + `mime`), never baked-in signed URLs; the Coordinator mints display URLs on demand.

## Rules
- Changing a schema is a **spec change**, raised explicitly (architecture plan §23.1) — not an implementation choice. Edit it **here**; every repo picks it up.
- `schema_version` is `major.minor`. Consumers **reject an unknown MAJOR** version.
- Validate with any JSON-Schema (draft 2020-12) validator — e.g. `ajv` (Node) or `jsonschema` (Python).

## Status & ownership
- **M0-now (this folder):** the two payload schemas above — the gate for parallel work. Drafted by Claude (architect) from the plan's appendices.
- **M0-later (rolls in with the autonomous loop):** the full **OpenAPI** document (Appendix C) and the standalone **contract-test-suite "referee."** Codex wires validation + the test harness around these schemas in **T-001**.
- If these later move to their own dedicated `contracts` repo/package, this folder is the seed.

## Field glossary (naming — reconciled per review)
Resolves inconsistent use of `line` / `line_of_business` / `quote_type` / `business_type`:
- **`line_of_business`** — slug, e.g. `professional_liability`. The canonical machine ID for the insurance **line**. (The bare `line` alias is retired — always use `line_of_business`.)
- **`profession`** — slug, e.g. `real_estate_agent`. The canonical machine ID for the profession/class within a line.
- **`business_type`** — human label, e.g. `Real Estate Agent`. Display string that maps to `profession`.
- **`quote_type`** / **`insurance_type`** — human labels (e.g. `Professional Liability`, `Professional Liability / E&O`). **Display only**, derived from `line_of_business`; never used as routing/storage keys.

**Rule:** route, branch, and store on the **slugs** (`line_of_business` + `profession`). The `*_type` fields are for UI/readability only.
