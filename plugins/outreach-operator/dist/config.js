import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const pluginRoot = path.resolve(currentDir, "..");
const envPath = path.join(pluginRoot, ".env");
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}
// The OAuth tokens live OUTSIDE the repo, next to the Salesforce JWT key, for the
// same reason: they are live credentials for production Outreach. The repo syncs
// between two machines over GitHub and these must never ride along.
export const CREDENTIAL_DIR = path.join(os.homedir(), ".config", "gtm-operator", "outreach");
export const TOKEN_PATH = path.join(CREDENTIAL_DIR, "tokens.json");
/** Default matches the callback URL registered on the Outreach app. */
export const DEFAULT_REDIRECT_URI = "https://127.0.0.1:5555/callback";
export function getPluginRoot() {
    return pluginRoot;
}
export function getEnvPath() {
    return envPath;
}
export function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing ${name}. Put it in ${envPath} before running the Outreach Operator plugin.`);
    }
    return value;
}
export function getRedirectUri() {
    return process.env.OUTREACH_REDIRECT_URI ?? DEFAULT_REDIRECT_URI;
}
/**
 * Mirrors the Salesforce operator's contract: GTM_READONLY=1 hard-blocks every
 * mutation, no matter what the caller asks for.
 */
export function isReadOnly() {
    const value = process.env.GTM_READONLY;
    return value === "1" || value?.toLowerCase() === "true";
}
export function assertWritable(operation) {
    if (isReadOnly()) {
        throw new Error(`GTM_READONLY is set, so ${operation} is blocked. Unset GTM_READONLY to allow Outreach mutations.`);
    }
}
