# PolicyGPT — AI Models & Cloud Services

_Which AI model powers each feature, and what's billed in Google Cloud. Last updated 2026-06-27. Model IDs are read from the code; the *live* provider/model for Q&A is decided by the `POLICYGPT_QA_PROVIDER` env var on the deployed coordinator (currently `claude`). See `LIVE_GCP_INVENTORY.md` for the exact live config._

---

## 1. AI models, by feature

| Feature | Where | Model (current prod) | Provider / billing | Notes |
|---|---|---|---|---|
| **Coverage Q&A** ("ask a PL question") | Coordinator `chat()` | **Claude Sonnet 4.6** (`claude-sonnet-4-6`) | Anthropic API | Because `POLICYGPT_QA_PROVIDER=claude`. If unset → **Gemini 2.5 Pro**. |
| **RAG grounded answer** (cited, when `RAG_ENABLED`) | Coordinator Evidence Service | **Claude Sonnet 4.6** (the QA provider) | Anthropic API | Answers **only** from retrieved, human-approved evidence. |
| **Guided quote intake** (one question at a time) | Coordinator intake | **Gemini 2.5 Flash** (`gemini-2.5-flash`) | Vertex AI | Fast/cheap conversational model. |
| **Internal "expert" classification** | Coordinator | **Gemini 2.5 Pro** (`gemini-2.5-pro`) | Vertex AI | Heavier reasoning. |
| **RAG embeddings** (text → vectors) | Coordinator Evidence Service | **`gemini-embedding-001`** | Vertex AI | 1536-dim; config-locked (only allowed embedding model). |
| **RAG reranker** | Coordinator Evidence Service | **None — deterministic algorithm** | n/a | Pure code/math; no AI call, no cost. |
| **UW Question Collection** (carrier-portal question crawler) | Rater adaptive engine | **Claude Sonnet 4.6** (`claude-sonnet-4-6`) — **pinned to the quality tier** | Anthropic API | Pinned so it never drops to the cheap tier — carriers use many input-field types that must be classified accurately. |
| **Rater adaptive vision — routine steps** | Rater (quoting) | **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) | Anthropic API | Cheap tier for ordinary clicks/reads. |
| **Rater adaptive vision — hard steps** | Rater (quoting) | **Claude Sonnet 4.6** (`claude-sonnet-4-6`) | Anthropic API | Auto-escalates from Haiku on ambiguity. |
| **Document `/analyze`** (separate service) | `policygpt-quote-analysis` | **Gemini 2.5 Pro** + **Document AI** processor | Vertex AI + Document AI | Called by the WordPress site; see note below. |

**Families:** Claude **Sonnet 4.6** (quality) + **Haiku 4.5** (cheap); Google **Gemini 2.5** (flash/pro) + the Gemini embedding model. Every model ID is env-overridable.

**Billing split:** Claude models → **Anthropic** (separate invoice, via `ANTHROPIC_API_KEY`). Gemini text/embeddings + Document AI → **Google Vertex AI / Document AI**. The **$100/month RAG budget** caps RAG-related spend inside the coordinator.

---

## 2. Google Cloud services billed (usage-based)

| Service | Role | Cost driver |
|---|---|---|
| **Cloud Run** | Runs `policygpt-quote-engine` (coordinator) + `policygpt-quote-analysis`. | vCPU/mem-seconds **while serving** + per-request; scales to zero (~$0 idle). |
| **Firestore** | Coordinator DB (sessions, jobs, corpus, chunks, audit). | Per read/write/delete + storage. Generous free tier. |
| **Cloud Storage** | `policygpt-production-private` (corpus + artifacts), `policygpt-quotes-storage` (quotes). | Storage GB-month + ops. Pennies at this scale. |
| **Secret Manager** | 5 secrets (PLUGIN/WORKER/ADMIN/CORPUS/ANTHROPIC_API_KEY). | ~$0.06/active version/mo (~$0.30 total) + access ops. |
| **Vertex AI** | Gemini text (intake/expert) + Gemini embeddings. | Per token. |
| **Document AI** | Used by `policygpt-quote-analysis` (`/analyze`). | Per page processed. |
| **Cloud Logging** | Coordinator logs. | 50 GB/mo free, then per GB. |
| **Cloud Build / Artifact Registry** | Build + store the coordinator image on each deploy. | Build-minutes (120/day free) + image storage. |

**Always-Free storage tier:** 5 GB-months of Standard storage in **regional** us-central1/us-east1/us-west1 (not multi-region). Both buckets are now **us-central1 regional** → eligible. Beyond free: ~$0.02/GB/month.

---

## 3. Notes worth knowing

- **`policygpt-quote-analysis` is ACTIVE, not legacy.** The WordPress site (`baddrivingrecord.com`) calls its `/analyze` endpoint; it uses Document AI + Gemini 2.5 Pro. ⚠️ As of 2026-06-27 those calls were returning **HTTP 422** (the feature is wired up but rejecting the request payload) — a broken feature worth fixing, not an idle service. **Do not delete it; do not disable Document AI.**
- **BigQuery Storage** API is enabled but unused by the current code/services (RAG MVP avoids BigQuery). Costs $0 unless used; optional to disable.
- **RAG is built but not yet ON in prod** — `RAG_ENABLED` is not set, so coverage answers are currently Claude Sonnet 4.6 **ungrounded** (no citations) until a corpus is promoted and the flag is enabled.

---

## 4. Quote-data retention

Quote/job artifacts write to **`policygpt-quotes-storage`** (us-central1 regional) with a **3-year (1095-day) auto-delete** lifecycle. The **RAG corpus** in `policygpt-production-private` has **no lifecycle (permanent)**. Buckets are physically separate so the retention policy can never reach the corpus, and corpus completion URIs are server-validated to the corpus bucket. ⚠️ Confirm 3-year retention against any insurance record-keeping requirements.
