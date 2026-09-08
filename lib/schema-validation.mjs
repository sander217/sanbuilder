import * as compiled from "./generated-schema-validators.mjs";

const validators = {
  "research-report.schema.json": compiled.validate_research_report_schema_json,
  "sanstudio-gate.schema.json": compiled.validate_sanstudio_gate_schema_json,
  "design-proposal.schema.json": compiled.validate_design_proposal_schema_json,
  "design-qa-report.schema.json": compiled.validate_design_qa_report_schema_json,
  "implementation-result.schema.json": compiled.validate_implementation_result_schema_json,
  "product-qa-report.schema.json": compiled.validate_product_qa_report_schema_json,
  "product-pr.schema.json": compiled.validate_product_pr_schema_json,
  "figma-backup.schema.json": compiled.validate_figma_backup_schema_json,
};

export function assertJsonSchema(schemaFile, value) {
  const validate = validators[schemaFile];
  if (typeof validate !== "function") throw new Error(`No standalone validator is registered for ${schemaFile}.`);
  if (validate(value)) return value;
  const detail = (validate.errors ?? [])
    .slice(0, 8)
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
  throw new Error(`${schemaFile}: ${detail || "artifact is invalid"}`);
}
