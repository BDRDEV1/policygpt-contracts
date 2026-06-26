import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, fileName), "utf8"));
}

const quoteJobSchema = readJson("quote-job.schema.json");
const completionSchema = readJson("completion.schema.json");

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const validateQuoteJob = ajv.compile(quoteJobSchema);
const validateCompletion = ajv.compile(completionSchema);

const quoteJob = {
  schema_version: "1.0",
  quote_session_id: "qs_123",
  job_id: "job_123",
  attempt: 1,
  fulfillment_mode: "automated",
  quote_type: "Professional Liability",
  line_of_business: "professional_liability",
  profession: "real_estate_agent",
  business_type: "Real Estate Agent",
  customer: {
    name: "Jane Customer",
    email: "jane@example.com",
    phone: "5551234567"
  },
  callback_url: "https://policygpt.com/wp-json/policygpt-professional-liability-rater/v1/webhooks/comparative-rater/quote-complete"
};

assert.equal(validateQuoteJob(quoteJob), true, JSON.stringify(validateQuoteJob.errors, null, 2));

const missingBusinessType = { ...quoteJob };
delete missingBusinessType.business_type;
assert.equal(validateQuoteJob(missingBusinessType), false, "quote job must require business_type");

const completion = {
  event_type: "policygpt.comparative_rater.quote.completed",
  event_id: "evt_123",
  quote_session_id: "qs_123",
  job_id: "job_123",
  status: "quote_ready",
  selected_carrier: "Carrier Name",
  premium: "1234.00",
  quote_number: "Q-123456",
  artifacts: [
    {
      kind: "quote_pdf",
      storage_path: "gs://policygpt-private/job_123/carrier-name.pdf",
      checksum: "sha256:abc123",
      mime: "application/pdf"
    }
  ],
  carrier_results: [
    {
      carrier: "Carrier Name",
      status: "quote_ready",
      premium: "1234.00",
      quote_number: "Q-123456",
      documents: [],
      notes: ""
    }
  ],
  errors: [],
  expires_at: "2026-07-18T00:00:00Z"
};

assert.equal(validateCompletion(completion), true, JSON.stringify(validateCompletion.errors, null, 2));
assert.ok(!Object.hasOwn(completionSchema.properties, "pdf_url"), "completion contract must not define pdf_url");
assert.equal(completionSchema.properties.artifacts.items.$ref, "#/$defs/artifact");

const invalidCompletion = {
  ...completion,
  event_type: "policygpt.comparative_rater.quote.finished"
};
assert.equal(validateCompletion(invalidCompletion), false, "completion event_type is frozen");

assert.ok(fs.existsSync(path.join(__dirname, "openapi.yaml")), "Appendix C OpenAPI skeleton is required");

// --- Additive RAG / AI architecture schemas (RAG-AI-000). Compile + spot-validate. ---
const evidenceAnswerSchema = readJson("evidence-answer.schema.json");
const knowledgeContextSchema = readJson("knowledge-context.schema.json");
const crawlerJobSchema = readJson("crawler-job.schema.json");
const evidencePacketSchema = readJson("evidence-packet.schema.json");

const validateEvidenceAnswer = ajv.compile(evidenceAnswerSchema);
const validateKnowledgeContext = ajv.compile(knowledgeContextSchema);
const validateCrawlerJob = ajv.compile(crawlerJobSchema);
const validateEvidencePacket = ajv.compile(evidencePacketSchema);

// crawler-job MUST stay separate from quote-job (do not add question_set_draft to fulfillment_mode).
assert.ok(
  !JSON.stringify(quoteJobSchema).includes("question_set_draft"),
  "quote-job fulfillment_mode must NOT include question_set_draft (crawler stays a separate discovery job)"
);

const evidenceAnswer = {
  schema_version: "1.0",
  answer_id: "ans_1",
  answer: "Based on reviewed sources, E&O covers professional negligence claims.",
  scope: "general",
  evidence_status: "supported",
  as_of_date: "2026-06-26",
  claims: [{ claim_id: "c1", text: "E&O covers negligence.", support: "direct", citation_ids: ["cit1"] }],
  citations: [{ citation_id: "cit1", source_label: "Reviewed PL guidance" }],
  disclaimer: "AI can make mistakes. Speak with a licensed agent to confirm."
};
assert.equal(validateEvidenceAnswer(evidenceAnswer), true, JSON.stringify(validateEvidenceAnswer.errors, null, 2));

const badStatus = { ...evidenceAnswer, evidence_status: "definitely_true" };
assert.equal(validateEvidenceAnswer(badStatus), false, "evidence_status is a closed enum");

assert.equal(validateKnowledgeContext({ line_of_business: "professional_liability", profession: "real_estate_agent" }), true);
assert.equal(validateKnowledgeContext({ profession: "real_estate_agent" }), false, "knowledge-context requires line_of_business");

const crawlerJob = {
  schema_version: "1.0",
  discovery_job_id: "disc_1",
  job_type: "question_set_discovery",
  line_of_business: "professional_liability",
  profession: "real_estate_agent",
  target_carriers: ["amwins_carrier_a"],
  review_required: true
};
assert.equal(validateCrawlerJob(crawlerJob), true, JSON.stringify(validateCrawlerJob.errors, null, 2));
assert.equal(validateCrawlerJob({ ...crawlerJob, review_required: false }), false, "discovery jobs are always review_required:true");

const evidencePacket = {
  schema_version: "1.0",
  evidence_packet_id: "ep_1",
  intent: "general_education",
  controlling_lane: "reviewed_guidance",
  as_of_date: "2026-06-26",
  slots: { line_of_business: "professional_liability", profession: "real_estate_agent" },
  candidates: [{ chunk_id: "ch1", authority_tier: "reviewed_guidance", visibility: "public", text: "...", vector_dim: 1536 }]
};
assert.equal(validateEvidencePacket(evidencePacket), true, JSON.stringify(validateEvidencePacket.errors, null, 2));
// Firestore vector ceiling guard (F1/F8): vector_dim > 2048 must fail.
assert.equal(
  validateEvidencePacket({ ...evidencePacket, candidates: [{ chunk_id: "ch1", authority_tier: "reviewed_guidance", visibility: "public", text: "...", vector_dim: 3072 }] }),
  false,
  "evidence-packet candidate vector_dim must not exceed 2048 (Firestore limit)"
);

// --- Command Center research-import bundle (policygpt.research_import_bundle.v1) ---
const researchImportSchema = readJson("research-import-bundle.schema.json");
const validateResearchImport = ajv.compile(researchImportSchema);

const researchImportBundle = {
  schema_version: "policygpt.research_import_bundle.v1",
  research_run: {
    research_job_id: "research_re_eo_ca_001",
    topic: "Real estate agent E&O policy forms, exclusions, endorsements (CA)",
    line_of_business: "professional_liability",
    profession: "real_estate_agent",
    generated_at: "2026-06-26T00:00:00Z",
    as_of_date: "2026-06-26",
    default_review_status: "unreviewed",
    target_corpus_id: "public_professional_liability_real_estate_agent"
  },
  source_urls: [{
    url_id: "url_abc",
    url: "https://example.com/re-eo-policy.pdf",
    normalized_url: "https://example.com/re-eo-policy.pdf",
    url_status: "direct_pdf_verified",
    result_category: "policy_form_pdf",
    first_seen_at: "2026-06-26T00:00:00Z",
    checked_at_research: "2026-06-26T00:00:00Z",
    should_check_for_updates: true,
    content_type_guess: "pdf",
    access_method: "direct_http",
    rights_status: "carrier_public_marketing"
  }],
  documents: [{
    document_id: "doc_abc",
    canonical_title: "Example RE Agents E&O Policy",
    line_of_business: "professional_liability",
    profession: "real_estate_agent",
    source_type: "carrier_public",
    authority_tier: "carrier_form",
    review_status: "unreviewed",
    rights_status: "carrier_public_marketing",
    policy_role: "base_policy_form",
    document_type: "pdf_policy_form",
    source_url: "https://example.com/re-eo-policy.pdf",
    url_status: "direct_pdf_verified",
    needs_manual_review: true
  }],
  download_manifest: [{
    manifest_id: "manifest_abc",
    document_id: "doc_abc",
    source_url: "https://example.com/re-eo-policy.pdf",
    retrieval_intent: "download_pdf",
    expected_mime_type: "application/pdf",
    requires_manual_terms_acceptance: false,
    rights_status: "carrier_public_marketing",
    parse_requested: true,
    target_visibility: "public"
  }]
};
assert.equal(validateResearchImport(researchImportBundle), true, JSON.stringify(validateResearchImport.errors, null, 2));

// schema_version is frozen; review_status must default unreviewed; retrieval disabled.
assert.equal(validateResearchImport({ ...researchImportBundle, schema_version: "policygpt.research_import_bundle.v2" }), false, "research-import schema_version is frozen to v1");
const reviewedDoc = JSON.parse(JSON.stringify(researchImportBundle));
reviewedDoc.documents[0].review_status = "reviewed";
assert.equal(validateResearchImport(reviewedDoc), false, "research-import documents must be unreviewed (nothing pre-approved)");

console.log("PolicyGPT contract smoke tests passed.");
