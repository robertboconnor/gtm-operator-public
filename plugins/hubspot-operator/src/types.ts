export interface ToolAudit {
  attempted: boolean;
  verified: boolean;
  targetType: string;
  targetId?: string;
  targetName?: string;
}

export interface ToolErrorShape {
  code: string;
  message: string;
  raw?: unknown;
}

export interface ToolEnvelope {
  [key: string]: unknown;
  ok: boolean;
  operation: string;
  data?: Record<string, unknown>;
  error?: ToolErrorShape;
  audit: ToolAudit;
  unsupported_via_api?: boolean;
}

export type CrmObjectType = "contacts" | "companies" | "deals" | "tickets";

export interface WorkflowSummary {
  id: string;
  name?: string;
  isEnabled?: boolean;
  objectTypeId?: string;
  revisionId?: string;
  type?: string;
  flowType?: string;
}
