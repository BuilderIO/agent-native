export interface ClipboardRuntimeLayerSnapshot {
  html: string;
  nodeCount: number;
}

/**
 * Resolve the document Copy should project for one screen.
 *
 * A localhost `/snapshot` can be only the server/source shell while the user
 * is selecting a hydrated runtime node. In that case the rendered layer
 * snapshot owns the selection id namespace. Inline screens continue using the
 * editable document so Alpine templates and authored markup round-trip.
 */
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
