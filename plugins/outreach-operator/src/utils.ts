import { OutreachApiError } from "./outreach.js";
import { OutreachAuthError } from "./oauth.js";
import type { ToolAudit, ToolEnvelope } from "./types.js";

export function makeEnvelope(
  operation: string,
  audit: ToolAudit,
  data?: Record<string, unknown>,
): ToolEnvelope {
  return { ok: true, operation, data, audit };
}

export function makeErrorEnvelope(input: {
  operation: string;
  error: unknown;
  audit: ToolAudit;
  unsupportedViaApi?: boolean;
  data?: Record<string, unknown>;
}): ToolEnvelope {
  const { error } = input;
  const tail = input.unsupportedViaApi ? { unsupported_via_api: true } : {};

  if (error instanceof OutreachApiError) {
    return {
      ok: false,
      operation: input.operation,
      data: input.data,
      error: {
        // A 403 here is almost always a missing OAuth scope rather than a
        // permission problem on the Outreach user — say so, don't guess.
        code: String(error.status),
        message:
          error.status === 403
            ? `${error.message} — this is usually a missing OAuth scope. Check the scope is ticked on the app in the Outreach developer portal, then re-run the login.`
            : error.message,
        raw: error.raw,
      },
      audit: input.audit,
      ...tail,
    };
  }

  if (error instanceof OutreachAuthError) {
    return {
      ok: false,
      operation: input.operation,
      data: input.data,
      error: { code: "auth_error", message: error.message },
      audit: input.audit,
      ...tail,
    };
  }

  return {
    ok: false,
    operation: input.operation,
    data: input.data,
    error: {
      code: "unexpected_error",
      message: error instanceof Error ? error.message : "Unexpected error",
      raw: error,
    },
    audit: input.audit,
    ...tail,
  };
}

export function toolTextResult(result: ToolEnvelope) {
  return JSON.stringify(result, null, 2);
}

/** Wraps a handler so every tool returns an envelope instead of throwing. */
export async function runTool(
  operation: string,
  audit: Omit<ToolAudit, "attempted" | "verified">,
  handler: () => Promise<{ data: Record<string, unknown>; verified?: boolean }>,
): Promise<ToolEnvelope> {
  try {
    const { data, verified } = await handler();

    return makeEnvelope(
      operation,
      { attempted: true, verified: verified ?? true, ...audit },
      data,
    );
  } catch (error) {
    return makeErrorEnvelope({
      operation,
      error,
      audit: { attempted: true, verified: false, ...audit },
    });
  }
}
