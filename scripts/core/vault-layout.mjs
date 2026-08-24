import path from "node:path";

export const VAULT_SCHEMA_VERSION = 2;
export const CONCEPTS_DIR = "concepts";
export const REFERENCES_DIR = "references";
export const SOURCES_DIR = "references/sources";
export const ASSETS_DIR = "references/assets";
export const ORIGINALS_DIR = "references/originals";
export const RUNTIME_DIR = ".my-wiki";
export const WORKFLOW_STATUSES = new Set([
  "inbox",
  "ima-pointer",
  "needs-followup",
  "processed",
  "stale"
]);

export function vaultDirectory(vault, relative) {
  return path.join(vault, ...String(relative).split("/"));
}

export function conceptDirectory(vault) {
  return vaultDirectory(vault, CONCEPTS_DIR);
}

export function sourceDirectory(vault) {
  return vaultDirectory(vault, SOURCES_DIR);
}

export function assetDirectory(vault, source = "") {
  return vaultDirectory(vault, source ? `${ASSETS_DIR}/${source}` : ASSETS_DIR);
}

export function originalDirectory(vault) {
  return vaultDirectory(vault, ORIGINALS_DIR);
}

export function isConceptId(id) {
  return String(id || "").startsWith(`${CONCEPTS_DIR}/`);
}

export function isSourceId(id) {
  return String(id || "").startsWith(`${SOURCES_DIR}/`);
}

export function isReferenceId(id) {
  return String(id || "").startsWith(`${REFERENCES_DIR}/`);
}

export function workflowStatus(frontmatter = {}, id = "") {
  const explicit = String(frontmatter.workflow_status || "").trim();
  if (explicit) return explicit;
  const legacy = String(frontmatter.status || "").trim();
  return isSourceId(id) && WORKFLOW_STATUSES.has(legacy) ? legacy : "unknown";
}

export function sourceFrontmatter(frontmatter = {}, workflow = "") {
  const previousStatus = String(frontmatter.workflow_status || frontmatter.status || workflow || "inbox");
  return {
    ...frontmatter,
    type: "Reference",
    status: ["draft", "stable", "deprecated"].includes(String(frontmatter.status)) ? frontmatter.status : "stable",
    workflow_status: WORKFLOW_STATUSES.has(previousStatus) ? previousStatus : workflow || "inbox"
  };
}
