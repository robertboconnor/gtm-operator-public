import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const cwd = process.cwd();
const outDir = path.join(cwd, "exports");
// mcp-remote caches its OAuth tokens here (version-pinned dir — see .mcp.json).
const authDir = path.join(os.homedir(), ".mcp-auth", "mcp-remote-0.1.37");
const mcpUrl = "https://api.salesforce.com/platform/mcp/v1/platform/sobject-all";
// The objects to export. Add your own custom objects (e.g. "My_Object__c").
// Override without editing this file via: SF_SCHEMA_OBJECTS="Account,Lead" node tools/export_salesforce_schema.mjs
const objects = (process.env.SF_SCHEMA_OBJECTS ?? "Account,Contact,Opportunity")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

function decodeJwtPayload(token) {
  const payload = token.split(".")[1];
  const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
  return JSON.parse(Buffer.from(padded, "base64url").toString("utf8"));
}

async function loadToken() {
  const files = (await readdir(authDir)).filter((file) => file.endsWith("_tokens.json"));
  const candidates = [];
  for (const file of files) {
    const tokenData = JSON.parse(await readFile(path.join(authDir, file), "utf8"));
    if (!tokenData.access_token) continue;
    const payload = decodeJwtPayload(tokenData.access_token);
    candidates.push({
      accessToken: tokenData.access_token,
      instanceUrl: payload.iss,
      expiresAt: payload.exp || 0,
      file,
    });
  }
  candidates.sort((a, b) => b.expiresAt - a.expiresAt);
  if (!candidates.length) throw new Error("No Salesforce access token found.");
  return candidates[0];
}

async function mcpPost(token, requestBody, sessionId) {
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(requestBody),
  });
  const text = await response.text();
  let responseBody;
  try {
    responseBody = JSON.parse(text);
  } catch {
    responseBody = text;
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(responseBody)}`);
  }
  return {
    sessionId: response.headers.get("mcp-session-id") || sessionId,
    body: responseBody,
  };
}

async function createMcpClient(token) {
  let nextId = 1;
  const init = await mcpPost(token, {
    jsonrpc: "2.0",
    id: nextId++,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "codex-salesforce-schema-export", version: "1.0.0" },
    },
  });
  const sessionId = init.sessionId;
  await mcpPost(token, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  }, sessionId);

  async function call(method, params) {
    const response = await mcpPost(token, {
      jsonrpc: "2.0",
      id: nextId++,
      method,
      params,
    }, sessionId);
    if (response.body.error) throw new Error(JSON.stringify(response.body.error));
    return response.body.result;
  }

  const tools = await call("tools/list", {});
  const soqlTool = tools.tools.find((tool) => tool.name === "soqlQuery")
    || tools.tools.find((tool) => /soql/i.test(tool.name));
  if (!soqlTool) throw new Error("No SOQL tool found.");

  async function soql(q) {
    const result = await call("tools/call", {
      name: soqlTool.name,
      arguments: { q },
    });
    const text = (result.content || [])
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      const message = parsed.map((item) => item.text || JSON.stringify(item)).join("\n");
      throw new Error(message);
    }
    return parsed;
  }

  return { soql };
}

async function queryAll(client, baseSoql, batchSize = 200) {
  const records = [];
  for (let offset = 0; ; offset += batchSize) {
    const page = await client.soql(`${baseSoql} LIMIT ${batchSize} OFFSET ${offset}`);
    const pageRecords = page.records || [];
    records.push(...pageRecords.map(stripAttributes));
    if (pageRecords.length < batchSize) break;
  }
  return records;
}

function stripAttributes(record) {
  const { attributes, ...rest } = record;
  return rest;
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const string = Array.isArray(value) || typeof value === "object"
    ? JSON.stringify(value)
    : String(value);
  return /[",\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

function toCsv(rows, columns) {
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ].join("\n");
}

function dlrsKey(record) {
  return `${record.dlrs__ParentObject__c}.${record.dlrs__AggregateResultField__c}`;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const token = await loadToken();
  const client = await createMcpClient(token);

  const dlrsRecords = await queryAll(
    client,
    [
      "SELECT DeveloperName, MasterLabel, dlrs__Active__c,",
      "dlrs__ParentObject__c, dlrs__ChildObject__c, dlrs__RelationshipField__c,",
      "dlrs__FieldToAggregate__c, dlrs__AggregateOperation__c,",
      "dlrs__AggregateResultField__c, dlrs__CalculationMode__c,",
      "dlrs__RelationshipCriteria__c",
      "FROM dlrs__LookupRollupSummary2__mdt",
      "WHERE Id != null",
      "ORDER BY dlrs__ParentObject__c, dlrs__AggregateResultField__c",
    ].join(" "),
  );

  const dlrsByParentField = new Map();
  for (const record of dlrsRecords) {
    if (!objects.includes(record.dlrs__ParentObject__c)) continue;
    const key = dlrsKey(record);
    if (!dlrsByParentField.has(key)) dlrsByParentField.set(key, []);
    dlrsByParentField.get(key).push(record);
  }

  const fieldRows = [];
  const objectDescriptions = {};
  for (const objectName of objects) {
    objectDescriptions[objectName] = { name: objectName };

    const fields = await queryAll(
      client,
      [
        "SELECT EntityDefinition.QualifiedApiName, QualifiedApiName, Label,",
        "DataType, IsCalculated, IsFieldHistoryTracked, IsIndexed,",
        "IsApiFilterable, IsApiSortable, Description",
        "FROM FieldDefinition",
        `WHERE EntityDefinition.QualifiedApiName = '${objectName}'`,
        "ORDER BY QualifiedApiName",
      ].join(" "),
    );
    for (const field of fields) {
      const matchingDlrs = dlrsByParentField.get(`${objectName}.${field.QualifiedApiName}`) || [];
      fieldRows.push({
        objectApiName: objectName,
        fieldApiName: field.QualifiedApiName,
        label: field.Label,
        salesforceType: field.DataType,
        dataType: field.DataType,
        length: "",
        precision: "",
        scale: "",
        referenceTo: "",
        relationshipName: "",
        isCustom: field.QualifiedApiName.endsWith("__c"),
        isCalculated: field.IsCalculated,
        isFormula: Boolean(field.IsCalculated && /^Formula\b/i.test(field.DataType || "")),
        calculatedFormula: "",
        isNativeRollupSummary: Boolean(
          field.IsCalculated && /^Roll-Up Summary\b/i.test(field.DataType || ""),
        ),
        isPopulatedByDlrs: matchingDlrs.length > 0,
        dlrsDefinitionNames: matchingDlrs.map((record) => record.DeveloperName).join("; "),
        dlrsLabels: matchingDlrs.map((record) => record.MasterLabel).join("; "),
        dlrsActive: matchingDlrs.map((record) => record.dlrs__Active__c).join("; "),
        dlrsChildObjects: matchingDlrs.map((record) => record.dlrs__ChildObject__c).join("; "),
        dlrsRelationshipFields: matchingDlrs
          .map((record) => record.dlrs__RelationshipField__c)
          .join("; "),
        dlrsAggregateOperations: matchingDlrs
          .map((record) => record.dlrs__AggregateOperation__c)
          .join("; "),
        dlrsFieldsToAggregate: matchingDlrs
          .map((record) => record.dlrs__FieldToAggregate__c)
          .join("; "),
        dlrsCalculationModes: matchingDlrs
          .map((record) => record.dlrs__CalculationMode__c)
          .join("; "),
        dlrsCriteria: matchingDlrs
          .map((record) => record.dlrs__RelationshipCriteria__c || "")
          .join("; "),
        createable: "",
        updateable: "",
        nillable: "",
        unique: "",
        externalId: "",
        idLookup: "",
        filterable: field.IsApiFilterable,
        sortable: field.IsApiSortable,
        groupable: "",
        nameField: "",
        autoNumber: /^Auto Number\b/i.test(field.DataType || ""),
        defaultedOnCreate: "",
        picklistValues: "",
        isIndexed: field.IsIndexed,
        isFieldHistoryTracked: field.IsFieldHistoryTracked,
        description: field.Description,
      });
    }
  }

  const summary = {
    exportedAt: new Date().toISOString(),
    sourceInstance: token.instanceUrl,
    objects,
    objectDescriptions,
    fieldCount: fieldRows.length,
    dlrsDefinitionCountTotal: dlrsRecords.length,
    dlrsDefinitionCountForExportedObjects: [...dlrsByParentField.values()].flat().length,
    fieldsPopulatedByDlrs: fieldRows.filter((row) => row.isPopulatedByDlrs).length,
    formulaFields: fieldRows.filter((row) => row.isFormula).length,
    nativeRollupSummaryFields: fieldRows.filter((row) => row.isNativeRollupSummary).length,
  };

  const exportObject = {
    ...summary,
    fields: fieldRows,
    dlrsDefinitionsForExportedObjects: [...dlrsByParentField.values()].flat(),
  };

  const columns = [
    "objectApiName",
    "fieldApiName",
    "label",
    "salesforceType",
    "dataType",
    "length",
    "precision",
    "scale",
    "referenceTo",
    "relationshipName",
    "isCustom",
    "isCalculated",
    "isFormula",
    "calculatedFormula",
    "isNativeRollupSummary",
    "isPopulatedByDlrs",
    "dlrsDefinitionNames",
    "dlrsLabels",
    "dlrsActive",
    "dlrsChildObjects",
    "dlrsRelationshipFields",
    "dlrsAggregateOperations",
    "dlrsFieldsToAggregate",
    "dlrsCalculationModes",
    "dlrsCriteria",
    "isIndexed",
    "isFieldHistoryTracked",
    "description",
    "createable",
    "updateable",
    "nillable",
    "unique",
    "externalId",
    "idLookup",
    "filterable",
    "sortable",
    "groupable",
    "nameField",
    "autoNumber",
    "defaultedOnCreate",
    "picklistValues",
  ];

  const jsonPath = path.join(outDir, "salesforce_schema_with_dlrs.json");
  const csvPath = path.join(outDir, "salesforce_schema_with_dlrs.csv");
  const dlrsPath = path.join(outDir, "salesforce_dlrs_definitions.json");

  await writeFile(jsonPath, `${JSON.stringify(exportObject, null, 2)}\n`);
  await writeFile(csvPath, `${toCsv(fieldRows, columns)}\n`);
  await writeFile(dlrsPath, `${JSON.stringify(exportObject.dlrsDefinitionsForExportedObjects, null, 2)}\n`);

  console.log(JSON.stringify({ jsonPath, csvPath, dlrsPath, summary }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
