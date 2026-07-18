#!/usr/bin/env node
/**
 * Salesforce Flow operator.
 *
 * Reads run freely. Every mutation is preview-first: the command shows what it
 * would do and stops. Nothing commits without --apply.
 *
 * Wraps the sf CLI, which owns org auth (~/.sf). No credentials live here.
 *
 *   node scripts/flow.mjs list [--active] [--type <ProcessType>]
 *   node scripts/flow.mjs retrieve <ApiName>
 *   node scripts/flow.mjs inspect  <ApiName> [--version <n>]
 *   node scripts/flow.mjs diff     <ApiName>
 *   node scripts/flow.mjs deploy   <ApiName> [--apply]
 *   node scripts/flow.mjs activate <ApiName> [--version <n>] [--apply]
 *   node scripts/flow.mjs deactivate <ApiName> [--apply]
 *   node scripts/flow.mjs delete   <ApiName> [--version <n>] [--apply]
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { outputPath } from "./lib/paths.mjs";

const execFileAsync = promisify(execFile);

const FLOW_DIR = "force-app/main/default/flows";
const argv = process.argv.slice(2);

function readArg(name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
}
const hasFlag = (name) => argv.includes(name);
const targetOrg = () => readArg("--target-org", process.env.SF_TARGET_ORG ?? "my-org");

// ── sf CLI plumbing ────────────────────────────────────────────────────────

async function sf(args) {
  const { stdout } = await execFileAsync("sf", [...args, "--json"], {
    maxBuffer: 64 * 1024 * 1024,
  }).catch((error) => {
    // sf exits non-zero on API errors but still prints JSON on stdout.
    if (error.stdout) return { stdout: error.stdout };
    throw error;
  });
  const payload = JSON.parse(stdout);
  if (payload.status !== 0) {
    const msg = payload.message ?? JSON.stringify(payload.result ?? payload);
    throw new Error(`sf ${args[0]} ${args[1] ?? ""} failed: ${msg}`);
  }
  return payload.result;
}

/** `sf api request rest` rejects --json and prints the raw response body. */
async function sfRest(path, { method = "GET", body } = {}) {
  const args = ["api", "request", "rest", path, "--method", method, "--target-org", targetOrg()];
  if (body !== undefined) args.push("--body", typeof body === "string" ? body : JSON.stringify(body));
  const { stdout, stderr } = await execFileAsync("sf", args, { maxBuffer: 16 * 1024 * 1024 }).catch((error) => {
    if (error.stdout || error.stderr) return { stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
    throw error;
  });
  const text = (stdout || "").trim();
  // Salesforce returns an empty 204 on a successful PATCH/DELETE.
  if (!text) {
    if (/error|not found|invalid/i.test(stderr || "")) throw new Error(`${method} ${path} -> ${stderr.trim()}`);
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${path} -> unparseable response: ${text.slice(0, 300)}`);
  }
  const failure = Array.isArray(parsed) ? parsed.find((e) => e.errorCode) : parsed.errorCode ? parsed : null;
  if (failure) throw new Error(`${method} ${path} -> ${failure.errorCode}: ${failure.message}`);
  return parsed;
}

const soql = (q) => sf(["data", "query", "--query", q, "--target-org", targetOrg()]);
const tooling = (q) =>
  sf(["data", "query", "--query", q, "--use-tooling-api", "--target-org", targetOrg()]);

/** Header row from FlowDefinitionView. Throws if the flow doesn't exist. */
async function flowHeader(apiName) {
  const result = await soql(
    `SELECT DurableId, ApiName, Label, ProcessType, TriggerType, IsActive,
            ActiveVersionId, LatestVersionId, VersionNumber, Description
     FROM FlowDefinitionView WHERE ApiName = '${apiName}'`,
  );
  const record = result.records?.[0];
  if (!record) throw new Error(`No flow named '${apiName}' in ${targetOrg()}.`);
  return record;
}

/** All versions of a flow, newest first. */
async function flowVersions(durableId) {
  const result = await soql(
    `SELECT DurableId, VersionNumber, Status, ApiVersionRuntime, LastModifiedDate
     FROM FlowVersionView WHERE FlowDefinitionViewId = '${durableId}'
     ORDER BY VersionNumber DESC`,
  );
  return result.records ?? [];
}

// ── output helpers ─────────────────────────────────────────────────────────

const banner = (text) => console.log(`\n${"─".repeat(4)} ${text} ${"─".repeat(Math.max(0, 68 - text.length))}`);

function previewGate(action, detail) {
  banner(`PREVIEW — nothing has changed`);
  console.log(detail);
  console.log(`\nThis was a preview. No change was committed.`);
  console.log(`To apply for real, re-run with --apply:\n  node scripts/flow.mjs ${action} --apply\n`);
}

// ── commands ───────────────────────────────────────────────────────────────

async function cmdList() {
  const filters = [];
  if (hasFlag("--active")) filters.push("IsActive = true");
  const type = readArg("--type");
  if (type) filters.push(`ProcessType = '${type}'`);
  const where = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";

  const result = await soql(
    `SELECT ApiName, Label, ProcessType, TriggerType, IsActive, VersionNumber
     FROM FlowDefinitionView${where} ORDER BY ApiName`,
  );
  const rows = result.records ?? [];
  banner(`${rows.length} flow(s) in ${targetOrg()}`);
  for (const r of rows) {
    const state = r.IsActive ? "ACTIVE  " : "inactive";
    console.log(
      `${state}  v${String(r.VersionNumber ?? "?").padEnd(3)} ${r.ApiName.padEnd(52)} ${r.ProcessType ?? ""}${
        r.TriggerType ? ` / ${r.TriggerType}` : ""
      }`,
    );
  }
}

async function cmdRetrieve(apiName) {
  const header = await flowHeader(apiName);
  const result = await sf([
    "project", "retrieve", "start",
    "--metadata", `Flow:${apiName}`,
    "--target-org", targetOrg(),
  ]);
  const files = (result.files ?? []).filter((f) => f.type === "Flow");
  banner(`Retrieved ${apiName} from ${targetOrg()}`);
  for (const f of files) console.log(`  ${f.state.padEnd(9)} ${f.filePath}`);
  console.log(
    `\nNote: Metadata API returns only the latest/active version (v${header.VersionNumber}).` +
      `\nVersion history is not retrievable as source — use 'inspect --version <n>' for older versions.`,
  );
}

/**
 * Collapse a FlowElementReferenceOrValue to its single meaningful value.
 * Salesforce returns the whole union with ~20 null members on every value.
 */
function val(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v !== "object") return JSON.stringify(v);
  if (v.elementReference) return v.elementReference;
  if (v.formulaExpression) return `formula(${v.formulaExpression})`;
  for (const key of ["stringValue", "booleanValue", "numberValue", "dateValue", "dateTimeValue", "timeValue", "apexValue"]) {
    if (v[key] !== null && v[key] !== undefined) return JSON.stringify(v[key]);
  }
  if (v.sobjectValue) return "(sobject)";
  if (v.collectionElements) return `(collection of ${[].concat(v.collectionElements).length})`;
  return "—";
}

/** Render Tooling API flow metadata as readable logic. */
function renderFlowLogic(md) {
  const lines = [];
  const push = (s = "") => lines.push(s);
  const ref = (c) => c?.targetReference ?? "(end)";

  push(`Label:        ${md.label}`);
  push(`Type:         ${md.processType}${md.start?.triggerType ? ` / ${md.start.triggerType}` : ""}`);
  push(`Status:       ${md.status}`);
  push(`API version:  ${md.apiVersion}`);
  if (md.description) push(`Description:  ${md.description}`);

  if (md.start) {
    push(`\nSTART`);
    if (md.start.object) push(`  object:      ${md.start.object}`);
    if (md.start.recordTriggerType) push(`  on:          ${md.start.recordTriggerType}`);
    if (md.start.filterLogic) push(`  filterLogic: ${md.start.filterLogic}`);
    for (const f of [].concat(md.start.filters ?? [])) {
      push(`  entry when:  ${f.field} ${f.operator} ${val(f.value)}`);
    }
    if (md.start.connector) push(`  → ${ref(md.start.connector)}`);
  }

  const section = (title, items, render) => {
    const list = [].concat(items ?? []).filter(Boolean);
    if (!list.length) return;
    push(`\n${title} (${list.length})`);
    for (const item of list) render(item);
  };

  section("DECISIONS", md.decisions, (d) => {
    push(`  ${d.name}  "${d.label}"`);
    for (const rule of [].concat(d.rules ?? [])) {
      const conds = [].concat(rule.conditions ?? []);
      const logic = rule.conditionLogic && rule.conditionLogic !== "and" ? `  [logic: ${rule.conditionLogic}]` : "";
      push(`    ${rule.label ? `"${rule.label}"` : rule.name} → ${ref(rule.connector)}${logic}`);
      conds.forEach((c, i) => {
        push(`        ${String(i + 1).padStart(2)}. ${c.leftValueReference} ${c.operator} ${val(c.rightValue)}`);
      });
    }
    push(`    else → ${ref(d.defaultConnector)}`);
  });

  section("RECORD LOOKUPS", md.recordLookups, (r) => {
    push(`  ${r.name}  ← ${r.object}  → ${ref(r.connector)}`);
    for (const f of [].concat(r.filters ?? [])) {
      push(`    where ${f.field} ${f.operator} ${val(f.value)}`);
    }
  });

  section("RECORD UPDATES", md.recordUpdates, (u) => {
    push(`  ${u.name}  → ${u.object ?? u.inputReference ?? "?"}  → ${ref(u.connector)}`);
    for (const a of [].concat(u.inputAssignments ?? [])) {
      push(`    set ${a.field} = ${val(a.value)}`);
    }
  });

  section("ASSIGNMENTS", md.assignments, (a) => {
    push(`  ${a.name}  → ${ref(a.connector)}`);
    for (const item of [].concat(a.assignmentItems ?? [])) {
      push(`    ${item.assignToReference} ${item.operator} ${val(item.value)}`);
    }
  });

  section("ACTION CALLS", md.actionCalls, (a) => {
    push(`  ${a.name}  "${a.label}"  [${a.actionType}: ${a.actionName}]  → ${ref(a.connector)}`);
  });

  section("FORMULAS", md.formulas, (f) => push(`  ${f.name} (${f.dataType}) = ${f.expression}`));
  section("VARIABLES", md.variables, (v) =>
    push(`  ${v.name} (${v.dataType})${v.isInput ? " in" : ""}${v.isOutput ? " out" : ""}`),
  );

  return lines.join("\n");
}

async function cmdInspect(apiName) {
  const header = await flowHeader(apiName);
  let versionId = header.ActiveVersionId ?? header.LatestVersionId;

  const wanted = readArg("--version");
  if (wanted) {
    const versions = await flowVersions(header.DurableId);
    const match = versions.find((v) => String(v.VersionNumber) === String(wanted));
    if (!match) {
      throw new Error(
        `${apiName} has no version ${wanted}. Available: ${versions.map((v) => v.VersionNumber).join(", ")}`,
      );
    }
    versionId = match.DurableId;
  }

  // Flow.Metadata is a compound field: fetch per-record by Id, never in a list query.
  const result = await tooling(`SELECT Id, Metadata FROM Flow WHERE Id = '${versionId}'`);
  const md = result.records?.[0]?.Metadata;
  if (!md) throw new Error(`No Metadata returned for version Id ${versionId}.`);

  banner(`${apiName} — version ${wanted ?? header.VersionNumber} (${versionId})`);
  console.log(renderFlowLogic(md));

  if (hasFlag("--json")) {
    const out = outputPath("flows", `${apiName}.v${wanted ?? header.VersionNumber}.json`);
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, `${JSON.stringify(md, null, 2)}\n`);
    console.log(`\nStructured JSON → ${out}`);
  }
}

async function cmdDiff(apiName) {
  const local = path.join(FLOW_DIR, `${apiName}.flow-meta.xml`);
  const localText = await fs.readFile(local, "utf8").catch(() => null);
  if (localText === null) {
    throw new Error(`No local copy at ${local}. Run: node scripts/flow.mjs retrieve ${apiName}`);
  }

  // sf requires --output-dir inside the project root; tmp/ is gitignored.
  await fs.mkdir("tmp", { recursive: true });
  const stage = await fs.mkdtemp(path.join("tmp", "flow-diff-"));
  try {
    await sf([
      "project", "retrieve", "start",
      "--metadata", `Flow:${apiName}`,
      "--target-org", targetOrg(),
      "--output-dir", stage,
    ]);

    // Retrieving to --output-dir yields mdapi format (.flow), not source (.flow-meta.xml).
    const orgText = await fs
      .readFile(path.join(stage, "flows", `${apiName}.flow`), "utf8")
      .catch(() => fs.readFile(path.join(stage, "flows", `${apiName}.flow-meta.xml`), "utf8"));

    if (orgText === localText) {
      banner(`No difference — local matches ${targetOrg()}`);
      return;
    }

    const orgCopy = path.join(stage, "org.xml");
    await fs.writeFile(orgCopy, orgText);
    banner(`Diff: ${targetOrg()} (−) vs local (+)`);
    const { stdout } = await execFileAsync("diff", ["-u", orgCopy, local]).catch((e) => ({ stdout: e.stdout ?? "" }));
    console.log(stdout || "(files differ only in whitespace/encoding)");
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

async function cmdDeploy(apiName) {
  const local = path.join(FLOW_DIR, `${apiName}.flow-meta.xml`);
  await fs.access(local).catch(() => {
    throw new Error(`No local file at ${local}. Nothing to deploy.`);
  });

  const header = await flowHeader(apiName).catch(() => null);
  const apply = hasFlag("--apply");

  const result = await sf([
    "project", "deploy", "start",
    "--metadata", `Flow:${apiName}`,
    "--target-org", targetOrg(),
    ...(apply ? [] : ["--dry-run"]),
  ]);

  const summary =
    `  org:        ${targetOrg()}\n` +
    `  flow:       ${apiName}\n` +
    `  source:     ${local}\n` +
    `  currently:  ${header ? `v${header.VersionNumber}, ${header.IsActive ? "ACTIVE" : "inactive"}` : "(new flow)"}\n` +
    `  result:     ${result.status}  (${result.numberComponentsDeployed ?? 0}/${result.numberComponentsTotal ?? 0} components)\n` +
    `\n  Deploying creates a NEW version. If the flow is active, the new version\n` +
    `  deploys INACTIVE — activate it explicitly afterward.`;

  if (!apply) {
    previewGate(`deploy ${apiName}`, summary);
    return;
  }
  banner(`DEPLOYED to ${targetOrg()}`);
  console.log(summary);
  const after = await flowHeader(apiName).catch(() => null);
  if (after) console.log(`\n  now:        v${after.VersionNumber}, ${after.IsActive ? "ACTIVE" : "inactive"}`);
}

async function setActiveVersion(apiName, versionNumber, { apply, action }) {
  const header = await flowHeader(apiName);
  const versions = await flowVersions(header.DurableId);

  if (versionNumber !== 0) {
    const match = versions.find((v) => String(v.VersionNumber) === String(versionNumber));
    if (!match) {
      throw new Error(
        `${apiName} has no version ${versionNumber}. Available: ${versions.map((v) => v.VersionNumber).join(", ")}`,
      );
    }
  }

  const summary =
    `  org:      ${targetOrg()}\n` +
    `  flow:     ${apiName}  "${header.Label}"\n` +
    `  from:     ${header.IsActive ? `ACTIVE v${header.VersionNumber}` : "inactive"}\n` +
    `  to:       ${versionNumber === 0 ? "DEACTIVATED (no active version)" : `ACTIVE v${versionNumber}`}\n` +
    (versionNumber === 0
      ? `\n  This stops the flow from running in production.`
      : `\n  This makes v${versionNumber} run in production on every matching record change.`);

  if (!apply) {
    previewGate(action, summary);
    return;
  }

  // FlowDefinition is Tooling-only, and Metadata is a compound field that only a
  // raw PATCH accepts. activeVersionNumber = 0 deactivates.
  const definition = await tooling(
    `SELECT Id FROM FlowDefinition WHERE DeveloperName = '${apiName}'`,
  );
  const definitionId = definition.records?.[0]?.Id;
  if (!definitionId) throw new Error(`No FlowDefinition for '${apiName}'.`);

  await sfRest(`/services/data/v64.0/tooling/sobjects/FlowDefinition/${definitionId}`, {
    method: "PATCH",
    body: { Metadata: { activeVersionNumber: versionNumber } },
  });

  banner(versionNumber === 0 ? `DEACTIVATED ${apiName}` : `ACTIVATED ${apiName} v${versionNumber}`);
  const after = await flowHeader(apiName);
  console.log(`  now: ${after.IsActive ? `ACTIVE v${after.VersionNumber}` : "inactive"} in ${targetOrg()}`);
}

async function cmdActivate(apiName) {
  const header = await flowHeader(apiName);
  const explicit = readArg("--version");
  const version = explicit ?? String(header.VersionNumber);
  await setActiveVersion(apiName, Number(version), {
    apply: hasFlag("--apply"),
    action: `activate ${apiName}${explicit ? ` --version ${explicit}` : ""}`,
  });
}

async function cmdDeactivate(apiName) {
  await setActiveVersion(apiName, 0, { apply: hasFlag("--apply"), action: `deactivate ${apiName}` });
}

async function cmdDelete(apiName) {
  const header = await flowHeader(apiName);
  const apply = hasFlag("--apply");
  const version = readArg("--version");

  // Salesforce refuses to delete an active flow. Fail loudly rather than at the API.
  if (header.IsActive && !version) {
    throw new Error(
      `${apiName} is ACTIVE (v${header.VersionNumber}). Salesforce will not delete an active flow.\n` +
        `Deactivate first:  node scripts/flow.mjs deactivate ${apiName} --apply`,
    );
  }

  if (version) {
    const versions = await flowVersions(header.DurableId);
    const match = versions.find((v) => String(v.VersionNumber) === String(version));
    if (!match) throw new Error(`${apiName} has no version ${version}.`);
    if (match.DurableId === header.ActiveVersionId) {
      throw new Error(`v${version} is the ACTIVE version. Deactivate before deleting it.`);
    }

    const summary =
      `  org:     ${targetOrg()}\n` +
      `  delete:  ${apiName} version ${version} only (${match.DurableId})\n` +
      `  status:  ${match.Status}\n` +
      `\n  IRREVERSIBLE. The version is gone; other versions survive.`;
    if (!apply) return previewGate(`delete ${apiName} --version ${version}`, summary);

    await sfRest(`/services/data/v64.0/tooling/sobjects/Flow/${match.DurableId}`, { method: "DELETE" });
    banner(`DELETED ${apiName} v${version}`);
    return;
  }

  // Whole-flow delete via destructiveChanges.xml.
  const versions = await flowVersions(header.DurableId);
  const summary =
    `  org:     ${targetOrg()}\n` +
    `  delete:  ${apiName}  "${header.Label}"  — ENTIRE FLOW\n` +
    `  status:  inactive (${versions.length} version(s): ${versions.map((v) => `v${v.VersionNumber}`).join(", ")})\n` +
    `\n  IRREVERSIBLE. Every version is destroyed.`;
  if (!apply) return previewGate(`delete ${apiName}`, summary);

  const stage = await fs.mkdtemp(path.join(os.tmpdir(), "flow-destroy-"));
  await fs.writeFile(
    path.join(stage, "destructiveChanges.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>${apiName}</members>
        <name>Flow</name>
    </types>
</Package>
`,
  );
  await fs.writeFile(
    path.join(stage, "package.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <version>64.0</version>
</Package>
`,
  );

  await sf([
    "project", "deploy", "start",
    "--metadata-dir", stage,
    "--target-org", targetOrg(),
  ]);
  banner(`DELETED ${apiName} (all versions) from ${targetOrg()}`);
}

// ── dispatch ───────────────────────────────────────────────────────────────

const COMMANDS = {
  list: cmdList,
  retrieve: cmdRetrieve,
  inspect: cmdInspect,
  diff: cmdDiff,
  deploy: cmdDeploy,
  activate: cmdActivate,
  deactivate: cmdDeactivate,
  delete: cmdDelete,
};

async function main() {
  const [command, maybeName] = argv;

  // Safe mode. Set GTM_READONLY=1 to make every mutation refuse at the source —
  // for unattended runs, where nobody is awake to approve a permission prompt.
  // Previews and dry-runs still work; only --apply is blocked.
  if (hasFlag("--apply") && process.env.GTM_READONLY === "1") {
    throw new Error(
      `GTM_READONLY=1 is set — refusing to --apply.\n` +
        `Safe mode blocks every mutation (deploy/activate/deactivate/delete).\n` +
        `Previews and dry-runs still run. To apply for real, unset it:\n` +
        `  GTM_READONLY= node scripts/flow.mjs ${argv.join(" ")}`,
    );
  }

  if (!command || hasFlag("--help") || hasFlag("-h") || !COMMANDS[command]) {
    console.log(
      `Salesforce Flow operator — reads run freely, mutations need --apply.\n\n` +
        `  list [--active] [--type <ProcessType>]\n` +
        `  retrieve <ApiName>\n` +
        `  inspect <ApiName> [--version <n>] [--json]\n` +
        `  diff <ApiName>\n` +
        `  deploy <ApiName> [--apply]\n` +
        `  activate <ApiName> [--version <n>] [--apply]\n` +
        `  deactivate <ApiName> [--apply]\n` +
        `  delete <ApiName> [--version <n>] [--apply]\n\n` +
        `Target org defaults to the SF_TARGET_ORG env var, else "my-org" (override with --target-org).\n`,
    );
    process.exitCode = command && !COMMANDS[command] ? 1 : 0;
    return;
  }

  const needsName = command !== "list";
  if (needsName && (!maybeName || maybeName.startsWith("--"))) {
    throw new Error(`'${command}' needs a flow API name. Example: node scripts/flow.mjs ${command} My_Flow`);
  }
  await COMMANDS[command](maybeName);
}

main().catch((error) => {
  console.error(`\n${error.message}\n`);
  process.exitCode = 1;
});
