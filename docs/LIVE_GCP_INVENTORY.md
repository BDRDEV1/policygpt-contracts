# PolicyGPT — Live GCP Inventory (snapshot)

_A point-in-time snapshot of the live `policygpt-production` Google Cloud project, captured **2026-06-27**. This is the layer that does NOT live in source code — it's what's actually deployed and configured. Regenerate with the gcloud commands at the bottom. Contains resource names + non-secret config only (never secret values)._

**Project:** `policygpt-production` · **Region:** `us-central1`

---

## 1. Cloud Run services

### `policygpt-quote-engine` (the Coordinator) — **active, primary**
- Latest revision: **`policygpt-quote-engine-00022-gng`** (100% traffic)
- Env vars:
  - `POLICYGPT_SESSION_STORE=firestore`
  - `POLICYGPT_JOB_STORE=firestore`
  - `POLICYGPT_ARTIFACT_STORE=gcs`
  - `POLICYGPT_PRIVATE_BUCKET=policygpt-production-private`
  - `GOOGLE_CLOUD_PROJECT=policygpt-production`
  - `POLICYGPT_QA_PROVIDER=claude`  ← **decides Q&A uses Claude Sonnet 4.6 (not Gemini)**
  - `POLICYGPT_CONTRACTS_DIR=/workspace/contracts`  ← vendored contracts path
  - `RAG_ENABLED` — **not set → RAG OFF** (grounded answers disabled until enabled)
- Reads secrets from Secret Manager at runtime via its service account.

### `policygpt-quote-analysis` (document `/analyze`) — **active, separate**
- Latest revision: **`policygpt-quote-analysis-00010-pv7`**
- Env vars: `GCP_PROJECT=policygpt-production`, `VERTEX_LOCATION=us-central1`, `MODEL_NAME=gemini-2.5-pro`, `DOCUMENTAI_PROCESSOR=projects/1045921351675/locations/us/processors/3a6c1c0a15863e61`
- Called by the WordPress site (`baddrivingrecord.com`) at `POST /analyze`. ⚠️ Returning **HTTP 422** as of 2026-06-27 (wired up but rejecting the request payload — broken feature, not idle). Uses **Document AI** + **Gemini 2.5 Pro**.

---

## 2. Cloud Storage buckets

| Bucket | Location | Class | Lifecycle |
|---|---|---|---|
| `policygpt-production-private` | us-central1 (regional) | Standard | **None — permanent** (RAG corpus under `corpus-vault/`) |
| `policygpt-quotes-storage` | us-central1 (regional) | Standard | **Delete @ age 1095 days (3 years)** (quote artifacts, may contain PII) |
| `policygpt-production_cloudbuild` | (system) | Standard | None — Cloud Build cache |
| `run-sources-policygpt-production-us-central1` | (system) | Standard | None — Cloud Run source uploads |

Coordinator service account (`policygpt-coordinator@policygpt-production.iam.gserviceaccount.com`) has `roles/storage.objectAdmin` on both data buckets.

---

## 3. Firestore
- Database: `(default)`, mode **FIRESTORE_NATIVE**, location **us-central1**.
- Holds: quote sessions, rater jobs, corpus records (document_versions, evidence_chunks, review tasks, promotions), audit logs, the RAG monthly-budget counter.

## 4. Secret Manager (names only — values never stored here)
`PLUGIN_SECRET`, `WORKER_SECRET`, `ADMIN_SECRET`, `CORPUS_SECRET`, `ANTHROPIC_API_KEY`.

## 5. Enabled APIs (relevant)
`run`, `firestore`, `storage*`, `secretmanager`, `aiplatform` (Vertex AI — Gemini + embeddings), `documentai` (used by quote-analysis), `cloudbuild`, `artifactregistry`, `logging`. **`bigquerystorage`** is enabled but **unused** by current code/services.

---

## 6. AI models in the live system
See `AI_MODELS_AND_SERVICES.md`. Summary: Q&A + RAG answers + rater/UW vision = **Claude** (Sonnet 4.6 / Haiku 4.5, Anthropic). Intake + expert + embeddings = **Gemini** (2.5 Flash / 2.5 Pro / gemini-embedding-001, Vertex). quote-analysis = Gemini 2.5 Pro + Document AI.

---

## 7. Regenerate this snapshot
```bash
# Cloud Run services + env
gcloud run services list --region us-central1
gcloud run services describe policygpt-quote-engine --region us-central1 --format='json(spec.template.spec.containers[0].env)'
gcloud run services describe policygpt-quote-analysis --region us-central1 --format='json(spec.template.spec.containers[0].env)'
# Buckets + lifecycle
gcloud storage buckets list
gcloud storage buckets describe gs://<bucket> --format='value(location,lifecycle_config)'
# Firestore / secrets / APIs
gcloud firestore databases list
gcloud secrets list   # names only
gcloud services list --enabled
```
