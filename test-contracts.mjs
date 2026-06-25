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

console.log("PolicyGPT contract smoke tests passed.");
