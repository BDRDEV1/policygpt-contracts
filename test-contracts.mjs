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

// --- Command Center research-import bundle (policygpt.research_import_bundle.v2) ---
const researchImportSchema = readJson("research-import-bundle.schema.json");
const validateResearchImport = ajv.compile(researchImportSchema);

const researchImportBundle = readJson("research-import-bundle.example.json");
assert.equal(validateResearchImport(researchImportBundle), true, JSON.stringify(validateResearchImport.errors, null, 2));

// schema_version is frozen to v2: the prior v1 string must now be rejected.
assert.equal(validateResearchImport({ ...researchImportBundle, schema_version: "policygpt.research_import_bundle.v1" }), false, "research-import schema_version is frozen to v2");
// review_status is enum-constrained (unreviewed|manual_review|reviewed|rejected, default unreviewed);
// arbitrary/pre-approved states are rejected by the schema. The "must import unreviewed" rule is
// additionally enforced server-side by the Coordinator importer (see coordinator self-tests).
const badStatusDoc = JSON.parse(JSON.stringify(researchImportBundle));
badStatusDoc.documents[0].review_status = "approved";
assert.equal(validateResearchImport(badStatusDoc), false, "research-import review_status must be one of the allowed enum values");

// --- Routed insurance platform v3 contracts ---
const v3Pairs = [
  ["rag-import-bundle.schema.json", "rag-import-bundle.example.json", "policygpt.rag_import_bundle.v3.0"],
  ["deep-research-output.schema.json", "deep-research-output.example.json", "policygpt.deep_research_output.v3.0"],
  ["intent-router-result.schema.json", "intent-router-result.example.json", "policygpt.intent_router_result.v1"],
  ["product-flow-registry.schema.json", "product-flow-registry.example.json", "policygpt.product_flow_registry.v1"],
  ["rag-evidence-answer.schema.json", "rag-evidence-answer.example.json", "policygpt.rag_evidence_answer.v2"]
];
for (const [schemaFile, exampleFile, version] of v3Pairs) {
  const validate = ajv.compile(readJson(schemaFile));
  const example = readJson(exampleFile);
  assert.equal(validate(example), true, `${exampleFile} valid: ${JSON.stringify(validate.errors)}`);
  assert.equal(example.schema_version, version, `${schemaFile} schema_version frozen to ${version}`);
}

// rag-evidence-answer: a blocked answer must report Blocked evidence strength.
const validateAnswer = ajv.getSchema("https://policygpt.com/contracts/rag-evidence-answer.schema.json");
const blockedAnswer = { ...readJson("rag-evidence-answer.example.json"), blocked: true, evidence_strength: "High" };
assert.equal(validateAnswer(blockedAnswer), false, "blocked answers must have evidence_strength Blocked");

// deep-research-output must NOT carry any retrieval/approval enabling fields (it only proposes).
const drSchema = readJson("deep-research-output.schema.json");
const candidateProps = Object.keys(drSchema.properties.source_candidates.items.properties);
for (const banned of ["retrieval_status", "review_status", "promotion_status", "public_answer_allowed"]) {
  assert.equal(candidateProps.includes(banned), false, `deep-research candidate must not include ${banned} (cannot self-approve)`);
}

// --- Hardened structural invariants must REJECT unsafe shapes (per contract design review) ---
const vRouter = ajv.getSchema("https://policygpt.com/contracts/intent-router-result.schema.json");
assert.equal(vRouter({ ...readJson("intent-router-result.example.json"), route_class: "claims_question", is_blocked: false }), false, "claims route must be blocked");
assert.equal(vRouter({ ...readJson("intent-router-result.example.json"), route_class: "quote_start", requires_registry_check: false }), false, "quote route must require registry check");

const vRegistry = ajv.getSchema("https://policygpt.com/contracts/product-flow-registry.schema.json");
const liveNoStates = JSON.parse(JSON.stringify(readJson("product-flow-registry.example.json")));
liveNoStates.products[0].supported_states = [];
assert.equal(vRegistry(liveNoStates), false, "live_quote_flow requires >=1 supported_state (licensing gate)");

const vImport = ajv.getSchema("https://policygpt.com/schemas/policygpt.rag_import_bundle.v3.schema.json");
const importPublic = JSON.parse(JSON.stringify(readJson("rag-import-bundle.example.json")));
importPublic.source_records[0].retrieval_policy.retrieval_status = "public_enabled";
assert.equal(vImport(importPublic), false, "import bundle cannot self-enable public retrieval");

const vAnswer = ajv.getSchema("https://policygpt.com/contracts/rag-evidence-answer.schema.json");
assert.equal(vAnswer({ ...readJson("rag-evidence-answer.example.json"), lane: "lane_d_safety_block", evidence_strength: "High" }), false, "safety-block lane must be Blocked strength");
assert.equal(vAnswer({ ...readJson("rag-evidence-answer.example.json"), retrieval_mode: "controlled_web_search", evidence_strength: "High" }), false, "web search cannot be High evidence");

console.log("PolicyGPT contract smoke tests passed.");
