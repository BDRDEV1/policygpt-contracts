# PolicyGPT — System Architecture (As-Built)

_Source of truth for how the system is actually built and deployed. Last updated 2026-06-27. Reflects all merged work to date, including RAG end-to-end, the Command Center, the v2 import schema, quote-storage isolation, and the live GCP configuration. See also `AI_MODELS_AND_SERVICES.md` and `LIVE_GCP_INVENTORY.md` in this folder._

---

## 1. What PolicyGPT is

An AI assistant + automated comparative rater for **professional liability / E&O insurance**. It answers coverage questions for the public (educational, provider-neutral, with a licensed-agent disclaimer) and automates obtaining quotes from carrier portals on a private operator Mac. Cited knowledge comes from a **human-reviewed corpus** built from Deep Research — nothing is auto-published.

First market: **California, real-estate-agent E&O** ("CA-first").

---

## 2. Three-tier architecture

```
TIER 1 — WordPress Plugin            TIER 2 — Cloud Run Coordinator        TIER 3 — Mac App (Command Center)
(public, PolicyGPT.com)              (trusted, system of record)           (private, operator)
 • Chat / coverage Q&A          —▶    • single index.js (~9k LOC, Node)  —▶  • Electron app
 • Quote intake forms          HMAC   • Firestore + GCS                  HMAC • Comparative Rater (quoting)
 • wp-admin: RAG budget         ◀—    • Evidence/RAG service              ◀—  • Command Center (ingestion)
 • RAG evidence cards (AI-060)         • Command Center import API              • Prompt Library
        PLUGIN_SECRET                  WORKER/ADMIN/CORPUS secrets              (creds in macOS Keychain)
```

Repos (GitHub org `BDRDEV1`):
- **policygpt-coordinator** — Cloud Run backend + RAG (service `policygpt-quote-engine`).
- **policygpt-rater** — Electron Command Center (quoting + ingestion + Prompt Library).
- **policygpt-plugin** — WordPress plugin (live v1.29.4).
- **policygpt-contracts** — JSON Schemas for every cross-tier message (this repo).

A **separate** Cloud Run service, **`policygpt-quote-analysis`**, provides a document-`/analyze` endpoint the WordPress site calls (uses Document AI + Gemini 2.5 Pro). See `LIVE_GCP_INVENTORY.md`.

---

## 3. Security model

- **HMAC signing** on every request: `X-PolicyGPT-Signature: sha256=HMAC(timestamp + "." + body, SECRET)` + timestamp; `/rater/*` and `/corpus/*` routes also require a nonce.
- **Four separate secrets**, never crossed: `PLUGIN_SECRET` (plugin↔coordinator), `WORKER_SECRET` (rater↔coordinator), `ADMIN_SECRET` (`/admin/*`), `CORPUS_SECRET` (`/corpus/*`).
- **Secret storage**: Google Secret Manager (cloud) / macOS Keychain (local). Never in source, config, logs, or git. Carrier/wholesaler passwords + Playwright session state are treated as secrets.
- The coordinator reads secrets from **Secret Manager at runtime** via its service account (not env injection).

---

## 4. Tier 1 — WordPress plugin (v1.29.4)

- Public **chat / coverage Q&A** (provider-neutral; markdown-rendered).
- **RAG evidence cards (AI-060)** — when the coordinator returns a grounded answer, the chat renders a "Sources" card (citation title + authority tier + page/section + safe link) + disclaimer. Degrades to the plain answer when there are no citations.
- **Quote intake** forms → posts a quote job to the coordinator.
- **wp-admin RAG budget control** — view/set the monthly cap (signs `/admin/rag/budget` with `ADMIN_SECRET`, masked).

## 5. Tier 2 — Coordinator (`policygpt-quote-engine`, rev 00022)

Single `index.js`. Self-tests via `POLICYGPT_RUN_SELF_TESTS=1`. Firestore/GCS in prod, in-memory under self-test.
- **Quote orchestration** — receives quote jobs; the rater claims them via `/rater/jobs/*` (atomic claim token, heartbeat, complete/fail).
- **Conversational intake** — `/quote/start` + `/quote/answer(-group)`: a 25-question E&O intake (7 sections, some as group cards) → on completion creates a rater job.
- **Evidence / RAG service** (`src/evidence/`) — retrieval with a review-gate, deterministic reranker, authority matrix, **budget guard** ($100/mo, Firestore), eval gates, disclaimer/byline. Grounded answers wired into the education path (gated by `RAG_ENABLED`, default off; hard fallback to the plain expert answer).
- **Command Center API** (`/admin/corpus/*`) — research-import (v2 schema), review/promote (the RAG gate).
- **Corpus job protocol** (`/corpus/*`) — atomic claim, checksum dedupe, download→version→parse→review-tasks. Corpus completion URIs are guarded to the corpus bucket only.
- **Contracts** are vendored into the deploy (`./contracts`, resolved by `resolveContractsDir()`), so `gcloud run deploy --source .` ships them — this fixed a quote-completion 500.

## 6. Tier 3 — Command Center (`policygpt-rater`)

Electron app. Credentials in Keychain. Two roles:

**A) Comparative Rater (quoting):** carrier registry + per-line URLs; **wholesaler support** (Amwins: login once → locate carrier → quote); **Patchright** stealth automation; human-paced clicks/typing; anti-bot checks; **email-OTP 2FA** (layer-agnostic) with operator-code modal; **wholesaler-aware question crawler** (drafts review-only).

**B) Command Center (ingestion):** **Research Imports** (upload a Deep Research bundle → validate → import); **corpus workers** (download → 7 parse artifacts incl. `document.md`); **Document Review** (review → **Approve = promote** to RAG).

**Prompt Library** — store reusable data-collection prompts + output reference guides locally; Copy / Download (save dialog defaulting to ~/Downloads) / Edit / Delete.

---

## 7. The AI / RAG system (how a cited answer is built)

RAG = **Retrieval-Augmented Generation**: retrieve vetted source text, then have the model answer **only** from it, with citations. Plus a hard rule: **nothing is retrievable until a human approves it.**

**Ingestion (operator, Command Center):** Deep Research → v2 import bundle → import (documents land **unreviewed / retrieval-disabled**) → download PDFs → parse into 7 artifacts → **review** → **promote** (the only path that enables retrieval; copies approved chunks to the public index, embeds them, writes promotion + audit). Promote refuses on bad rights / low parser confidence / superseded / missing page-section.

**Serving (live, when `RAG_ENABLED`):** embed the question → vector-search the **approved** chunks → deterministic rerank + authority matrix → budget check → generate a grounded answer (Claude Sonnet 4.6) from those chunks → return answer + citations + disclaimer + byline → plugin renders Sources cards. **Fallback** to the plain expert answer on RAG-off / no-evidence / budget / any error.

**Safety invariants:** nothing shown that wasn't approved (enforced at promote-time and retrieval-time, server-side — the importer never trusts a `reviewed` flag in a bundle); every policy claim cited; $100/mo budget cap; graceful degradation. MVP stack is intentionally lean — **Firestore + GCS only** (no AlloyDB / Vertex Vector Search / paid reranker / BigQuery / graph). Vectors are 1536-dim.

---

## 8. Data contracts (`policygpt-contracts`)

`quote-job` (coordinator→rater), `completion` (rater→coordinator), `question-set-draft` (UW crawler→coordinator, review-only), `crawler-job`, `research-import-bundle` (**v2**: 64 defs, 21-field document_candidate, 11 optional richer sections; new sections currently "stored-now"), `evidence-answer` / `evidence-packet` / `knowledge-context` (RAG shapes).

---

## 9. Storage layout + retention

| Bucket | Holds | Lifecycle |
|---|---|---|
| `policygpt-production-private` (us-central1) | `corpus-vault/…` = RAG corpus + `artifacts/…` historically | **None — permanent** (corpus must never auto-delete) |
| `policygpt-quotes-storage` (us-central1) | quote/job artifacts (`artifacts/…`, may contain PII) | **Delete after 3 years (1095 days)** |

Quote artifacts now route to the **separate** quotes bucket so a retention policy can expire them with **zero** risk to the corpus (bucket-level isolation). Corpus completion URIs are server-validated to `gs://…/corpus-vault/` so a worker bug can't land corpus data in the expiring bucket.

---

## 10. Build status (2026-06-27)

All tracks complete: wholesaler ✅, 2FA ✅, RAG end-to-end ✅ (ingest→…→citation cards), M6 reliable-automation (Patchright + T-101…105) ✅, Command Center ✅, v2 import schema ✅, Prompt Library ✅. Coordinator deployed (rev 00022); plugin live (v1.29.4). **To make RAG live:** ingest a corpus (import→review→promote) + set `RAG_ENABLED=true`. **Operating model:** Claude authors (esp. UI/glue), Codex reviews; hard backend = Codex authors + Claude reviews; nothing merges without a second set of eyes.

---

## 11. Where things live

All code → the 4 GitHub repos. Live deployment config (which model is on, services, buckets, lifecycle, secrets) → GCP (see `LIVE_GCP_INVENTORY.md`). The running Command Center → a local clone at `~/PolicyGPT-Rater` (credentials persist in Keychain).
