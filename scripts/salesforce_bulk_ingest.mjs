import fs from "node:fs/promises";
import path from "node:path";
import { outputPath } from "./lib/paths.mjs";
import {
  SalesforceBulkApi2Client,
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

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const object = requireArg("--object");
  const operation = readArg("--operation", "update");
  const csvPath = requireArg("--csv");
  const outputDir = readArg("--output-dir", outputPath(`salesforce-bulk/${new Date().toISOString().replace(/[:.]/g, "-")}`));
  const externalIdFieldName = readArg("--external-id-field");
  const lineEnding = readArg("--line-ending", "LF");
  const pollIntervalMs = Number(readArg("--poll-interval-ms", "5000"));
  const timeoutMs = Number(readArg("--timeout-ms", String(30 * 60 * 1000)));
  const apiVersion = readArg("--api-version", process.env.SALESFORCE_API_VERSION ?? "v61.0");
  const sessionPath = readArg("--session-path", process.env.SALESFORCE_BULK_SESSION_PATH);
  const dryRun = process.argv.includes("--dry-run");

  if (!["insert", "delete", "hardDelete", "update", "upsert"].includes(operation)) {
    throw new Error(`Unsupported Bulk API ingest operation: ${operation}`);
  }
  if (operation === "upsert" && !externalIdFieldName) {
    throw new Error("--external-id-field is required for upsert.");
  }

  const csv = await fs.readFile(csvPath, "utf8");
  const header = csv.split(/\r?\n/, 1)[0] ?? "";
  if (!header.split(",").includes("Id") && operation === "update") {
    throw new Error("Update CSV must include an Id column.");
  }

  await fs.mkdir(outputDir, { recursive: true });
  await fs.copyFile(csvPath, path.join(outputDir, "input.csv"));

  const plan = {
    object,
    operation,
    csvPath,
    outputDir,
    apiVersion,
    externalIdFieldName,
    lineEnding,
    inputBytes: Buffer.byteLength(csv),
    header,
  };
  await writeJson(path.join(outputDir, "plan.json"), plan);

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, ...plan }, null, 2));
    return;
  }

  const session = await loadSalesforceSession({ sessionPath });
  const client = new SalesforceBulkApi2Client(session, { apiVersion });
  const createdJob = await client.createIngestJob({ object, operation, externalIdFieldName, lineEnding });
  await writeJson(path.join(outputDir, "job-created.json"), createdJob);

  await client.uploadJobCsv(createdJob.id, csv);
  const closedJob = await client.closeIngestJob(createdJob.id);
  await writeJson(path.join(outputDir, "job-closed.json"), closedJob);

  const finalJob = await client.pollIngestJob(createdJob.id, { pollIntervalMs, timeoutMs });
  await writeJson(path.join(outputDir, "job-final.json"), finalJob);

  const results = await client.getIngestResults(createdJob.id);
  await fs.writeFile(path.join(outputDir, "successful-results.csv"), results.successfulResults);
  await fs.writeFile(path.join(outputDir, "failed-results.csv"), results.failedResults);
  await fs.writeFile(path.join(outputDir, "unprocessed-records.csv"), results.unprocessedRecords);

  console.log(
    JSON.stringify(
      {
        jobId: createdJob.id,
        state: finalJob.state,
        object,
        operation,
        numberRecordsProcessed: finalJob.numberRecordsProcessed,
        numberRecordsFailed: finalJob.numberRecordsFailed,
        outputDir,
      },
      null,
      2,
    ),
  );

  if (finalJob.state !== "JobComplete" || Number(finalJob.numberRecordsFailed ?? 0) > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
