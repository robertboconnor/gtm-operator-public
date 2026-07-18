import os from "node:os";
import path from "node:path";

// Everything scripts write — Salesforce/HubSpot pulls, audits, exports — tends to
// contain customer PII, so it resolves OUTSIDE the repo by default and can never be
// committed or pushed. Override with GTM_OUTPUT_ROOT to point runs anywhere else.
export const OUTPUT_ROOT =
  process.env.GTM_OUTPUT_ROOT ?? path.join(os.homedir(), "gtm-operator-output");

export function outputPath(...segments) {
  return path.join(OUTPUT_ROOT, "outputs", ...segments);
}

export function exportPath(...segments) {
  return path.join(OUTPUT_ROOT, "exports", ...segments);
}
