import fs from "node:fs";
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
export function getPluginRoot() {
    return pluginRoot;
}
export function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing ${name}. Put it in ${envPath} before running the HubSpot Operator plugin.`);
    }
    return value;
}
