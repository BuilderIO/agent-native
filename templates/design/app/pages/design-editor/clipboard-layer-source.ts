export interface ClipboardRuntimeLayerSnapshot {
  html: string;
  nodeCount: number;
}

export function resolveClipboardLayerSourceHtml(args: {
  runtimeProjectionEligible: boolean;
  runtimeSnapshot?: ClipboardRuntimeLayerSnapshot;
  liveSnapshotHtml?: string;
  storedContent?: string;
}): string {
  if (
    args.runtimeProjectionEligible &&
    args.runtimeSnapshot &&
    args.runtimeSnapshot.nodeCount > 0
  ) {
    return args.runtimeSnapshot.html;
  }
  return args.liveSnapshotHtml ?? args.storedContent ?? "";
}
