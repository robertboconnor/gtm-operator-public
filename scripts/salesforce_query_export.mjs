import fs from "node:fs/promises";
import path from "node:path";
import {
  SalesforceBulkApi2Client,
  csvEscape,
  loadSalesforceSession,
} from "./lib/salesforce_bulk_api_2.mjs";

function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

function requireArg(name) {
  const value = readArg(name);
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
}

function readRepeatedArg(name) {
  const values = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === name && process.argv[i + 1]) values.push(process.argv[i + 1]);
  }
  return values;
}

function parseSetArgs(values) {
  const constants = new Map();
  for (const value of values) {
    const separator = value.indexOf("=");
    if (separator === -1) throw new Error(`Invalid --set value: ${value}. Expected FieldApiName=value.`);
    constants.set(value.slice(0, separator), value.slice(separator + 1));
  }
  return constants;
}

function getPathValue(record, fieldPath) {
  return fieldPath.split(".").reduce((value, part) => value?.[part], record);
}

async function main() {
  const soql = requireArg("--soql");
  const outputDir = requireArg("--output-dir");
  const columns = readArg("--columns", "Id").split(",").map((column) => column.trim()).filter(Boolean);
  const csvName = readArg("--csv-name", "records.csv");
  const constants = parseSetArgs(readRepeatedArg("--set"));
  const apiVersion = readArg("--api-version", process.env.SALESFORCE_API_VERSION ?? "v61.0");
  const sessionPath = readArg("--session-path", process.env.SALESFORCE_BULK_SESSION_PATH);

  await fs.mkdir(outputDir, { recursive: true });

  const session = await loadSalesforceSession({ sessionPath });
  const client = new SalesforceBulkApi2Client(session, { apiVersion });
  const result = await client.queryAllRecords(soql);
  const records = result.records.map(({ attributes, ...record }) => record);

  await fs.writeFile(path.join(outputDir, "query.soql"), `${soql}\n`);
  await fs.writeFile(path.join(outputDir, "records.json"), `${JSON.stringify(records, null, 2)}\n`);

  const csv = [
    columns.map(csvEscape).join(","),
    ...records.map((record) =>
      columns
        .map((column) => csvEscape(constants.has(column) ? constants.get(column) : getPathValue(record, column)))
        .join(","),
    ),
  ].join("\n");
  await fs.writeFile(path.join(outputDir, csvName), `${csv}\n`);

  console.log(
    JSON.stringify(
      {
        totalSize: result.totalSize,
        records: records.length,
        outputDir,
        columns,
        csvName,
        constants: Object.fromEntries(constants),
      },
      null,
      2,
    ),
  );

  if (result.totalSize !== records.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
