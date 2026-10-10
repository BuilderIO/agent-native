import type { EffectInstance, EffectTransform2D } from "./native-effects";

export type NativeInstancePreviewSet = {
  type: "native-effect-set-instance";
  schemaVersion: 1;
  requestId: string;
  sequence: number;
  runtimeEpoch: string;
  instanceId: string;
  nodeId: string;
  baseExecutionHash: string;
  baseInstanceSignature: string;
  transform: EffectTransform2D | null;
  opacity: number;
};

export type NativeInstancePreviewClear = {
  type: "native-effect-clear-instance";
  schemaVersion: 1;
  requestId: string;
  sequence: number;
  runtimeEpoch: string;
  instanceId: string;
  nodeId: string;
  baseExecutionHash: string;
  baseInstanceSignature: string;
};

export type NativeInstancePreviewRequest =
  | NativeInstancePreviewSet
  | NativeInstancePreviewClear;

export type NativeInstancePreviewResult = {
  type: "native-effect-instance-result";
  schemaVersion: 1;
  requestId: string;
  sequence: number;
  runtimeEpoch: string;
  instanceId: string;
  nodeId: string;
  status: "pending" | "ready" | "error";
  displayed: "preview" | "published";
  code?: string;
  message?: string;
};

export async function hashEffectInstance(
  instance: EffectInstance,
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(instance));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
