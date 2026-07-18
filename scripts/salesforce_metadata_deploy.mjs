import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SalesforceBulkApi2Client, loadSalesforceSession } from "./lib/salesforce_bulk_api_2.mjs";

const execFileAsync = promisify(execFile);

function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function readRepeatedArg(name) {
  const values = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === name && process.argv[i + 1]) values.push(process.argv[i + 1]);
  }
  return values;
}

function usage() {
  return `Usage:
  node scripts/salesforce_metadata_deploy.mjs [--build-only] [--deploy] [--package manifest/package.xml] [--source-dir force-app/main/default] [--include-directory objects]
  node scripts/salesforce_metadata_deploy.mjs --status <deployId>

Defaults to check-only validation. Pass --deploy to make the deployment real.
`;
}

function metadataApiFileName(sourceFileName) {
  return sourceFileName.replace(/-meta\.xml$/, "");
}

async function copyMetadataEntry(sourcePath, targetPath) {
  const stat = await fs.stat(sourcePath);
  if (stat.isDirectory()) {
    await fs.mkdir(targetPath, { recursive: true });
    const entries = await fs.readdir(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      await copyMetadataEntry(
        path.join(sourcePath, entry.name),
        path.join(targetPath, metadataApiFileName(entry.name)),
      );
    }
    return;
  }

  if (stat.isFile() && sourcePath.endsWith("-meta.xml")) {
    await fs.copyFile(sourcePath, targetPath);
  }
}

async function copySourceMetadataDirectory(sourceRoot, deployRoot, directoryName) {
  const sourceDirectory = path.join(sourceRoot, directoryName);
  const entries = await fs.readdir(sourceDirectory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });

  if (entries.length === 0) return;

  const deployDirectory = path.join(deployRoot, directoryName);
  await fs.mkdir(deployDirectory, { recursive: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDirectory, entry.name);
    const targetPath = path.join(deployDirectory, metadataApiFileName(entry.name));
    await copyMetadataEntry(sourcePath, targetPath);
  }
}

async function createMetadataZip({ packagePath, sourceRoot, outputDir, directoryNames }) {
  outputDir = path.resolve(outputDir);
  const deployRoot = path.join(outputDir, "unpackaged");
  await fs.mkdir(deployRoot, { recursive: true });
  await fs.copyFile(packagePath, path.join(deployRoot, "package.xml"));

  for (const directoryName of directoryNames) {
    await copySourceMetadataDirectory(sourceRoot, deployRoot, directoryName);
  }

  const zipPath = path.join(outputDir, "metadata-deploy.zip");
  await execFileAsync("zip", ["-qr", zipPath, "."], { cwd: deployRoot });

  return { deployRoot, zipPath };
}

function deployOptions({ checkOnly, testLevel, runTests }) {
  const options = {
    deployOptions: {
      allowMissingFiles: false,
      autoUpdatePackage: false,
      checkOnly,
      ignoreWarnings: false,
      performRetrieve: false,
      purgeOnDelete: false,
      rollbackOnError: true,
      singlePackage: true,
      testLevel,
    },
  };
  if (runTests.length > 0) options.deployOptions.runTests = runTests;
  return options;
}

async function deployZip(client, { zipPath, checkOnly }) {
  const zipBuffer = await fs.readFile(zipPath);
  const boundary = `----salesforce-metadata-${Date.now().toString(16)}`;
  const testLevel = readArg("--test-level", "RunLocalTests");
  const runTests = readRepeatedArg("--run-test");
  const json = JSON.stringify(deployOptions({ checkOnly, testLevel, runTests }));
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="entity_content"\r\n` +
        `Content-Type: application/json\r\n\r\n` +
        `${json}\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="metadata-deploy.zip"\r\n` +
        `Content-Type: application/zip\r\n\r\n`,
      "utf8",
    ),
    zipBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);

  const response = await client.request(`/services/data/${client.apiVersion}/metadata/deployRequest`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
  });
  const text = await response.text();
  const result = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Deploy request failed -> ${response.status}: ${JSON.stringify(result)}`);
  }
  return result;
}

async function getDeployStatus(client, deployId) {
  return client.json(`/services/data/${client.apiVersion}/metadata/deployRequest/${deployId}?includeDetails=true`);
}

async function pollDeploy(client, deployId) {
  while (true) {
    const status = await getDeployStatus(client, deployId);
    if (status.done) return status;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

function summarizeDeployResult(result) {
  const deployResult = result.deployResult ?? result;
  const details = deployResult.details ?? {};
  return {
    id: result.id ?? deployResult.id,
    done: deployResult.done,
    success: deployResult.success,
    status: deployResult.status,
    numberComponentsDeployed: deployResult.numberComponentsDeployed,
    numberComponentsTotal: deployResult.numberComponentsTotal,
    numberComponentErrors: deployResult.numberComponentErrors,
    componentFailures: details.componentFailures ?? [],
  };
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log(usage());
    return;
  }

  const apiVersion = readArg("--api-version", process.env.SALESFORCE_API_VERSION ?? "v64.0");
  const sessionPath = readArg("--session-path", process.env.SALESFORCE_BULK_SESSION_PATH);
  const session = await loadSalesforceSession({ sessionPath });
  const client = new SalesforceBulkApi2Client(session, { apiVersion });

  const statusDeployId = readArg("--status");
  if (statusDeployId) {
    const result = await getDeployStatus(client, statusDeployId);
    console.log(JSON.stringify(summarizeDeployResult(result), null, 2));
    const deployResult = result.deployResult ?? result;
    if (deployResult.done && !deployResult.success) process.exitCode = 1;
    return;
  }

  const packagePath = readArg("--package", "manifest/package.xml");
  const sourceRoot = readArg("--source-dir", "force-app/main/default");
  const directoryNames = readRepeatedArg("--include-directory");
  if (directoryNames.length === 0) {
    directoryNames.push("flows", "notificationtypes", "objects");
  }
  const checkOnly = !hasFlag("--deploy");
  const buildOnly = hasFlag("--build-only");
  const outputDir = readArg("--output-dir", await fs.mkdtemp(path.join(os.tmpdir(), "salesforce-mdapi-")));

  const { deployRoot, zipPath } = await createMetadataZip({ packagePath, sourceRoot, outputDir, directoryNames });
  if (buildOnly) {
    console.log(
      JSON.stringify(
        {
          mode: "build-only",
          deployRoot,
          zipPath,
        },
        null,
        2,
      ),
    );
    return;
  }

  const deployRequest = await deployZip(client, { zipPath, checkOnly });
  const deployId = deployRequest.id ?? deployRequest.deployResult?.id;
  if (!deployId) {
    throw new Error(`Salesforce did not return a deploy id: ${JSON.stringify(deployRequest)}`);
  }
  console.error(`Salesforce deploy request accepted: ${deployId}`);

  const result = await pollDeploy(client, deployId);
  console.log(
    JSON.stringify(
      {
        mode: checkOnly ? "check-only" : "deploy",
        instanceUrl: session.instanceUrl,
        deployRoot,
        zipPath,
        ...summarizeDeployResult(result),
      },
      null,
      2,
    ),
  );

  const deployResult = result.deployResult ?? result;
  if (!deployResult.success) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
