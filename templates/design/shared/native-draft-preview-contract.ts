import type { EffectDefinition } from "./native-effects";

export type NativeDraftPreviewRequest = {
  type: "native-shader-draft-preview";
  schemaVersion: 1;
  requestId: string;
  runtimeEpoch: string;
  instanceId: string;
  nodeId: string;
  baseExecutionHash: string;
  expectedExecutionHash: string;
  draftDefinition: EffectDefinition;
  params: Record<string, unknown>;
  seed: number;
  time: number;
};

export type NativeDraftPreviewControl = {
  type: "native-shader-draft-control";
  schemaVersion: 1;
  requestId: string;
  runtimeEpoch: string;
  instanceId: string;
  baseExecutionHash: string;
  command:
    | "clear"
    | "show-published"
    | "show-draft"
    | "set-time"
    | "play"
    | "pause";
  time?: number;
};

export type NativeDraftPreviewDiagnostic = {
  code: string;
  message: string;
  severity: "error" | "warning" | "info";
  passId?: string;
  line?: number;
  column?: number;
};

export type NativeDraftPreviewResult = {
  type: "native-shader-draft-result";
  schemaVersion: 1;
  requestId: string;
  runtimeEpoch: string;
  instanceId: string;
  status: "pending" | "ready" | "last-good" | "error";
  displayed: "none" | "published" | "draft-current" | "draft-last-good";
  executionHash?: string;
  diagnostics: NativeDraftPreviewDiagnostic[];
  timings?: {
    compileWallMs?: number;
    renderWallMs?: number;
  };
};

export type NativeDraftPreviewMessage =
  | NativeDraftPreviewRequest
  | NativeDraftPreviewControl;
