export type NativePresentationFaultRuntimeTarget = {
  designId: string;
  fileId: string;
  ownerTabId: string;
  sourceVersionHash: string;
  sourceSha256: string;
  caseId: string;
  instanceId: string;
  nodeId: string;
  definitionId: string;
  definitionVersion: number;
  executionHash: string;
};

export const REVIEWED_LOCAL_RUNTIME_TARGET: NativePresentationFaultRuntimeTarget | null =
  null;
