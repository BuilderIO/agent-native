import { NativeSourceError } from "./native-source-provider";

export function resolveNativeExportSelection(
  doc: Document,
  nodeIds: readonly string[] | undefined,
): readonly Element[] | undefined {
  if (nodeIds === undefined) return undefined;
  if (
    !Array.isArray(nodeIds) ||
    nodeIds.length < 1 ||
    nodeIds.length > 128 ||
    new Set(nodeIds).size !== nodeIds.length ||
    nodeIds.some((id) => typeof id !== "string" || !id || id.length > 256)
  )
    throw new NativeSourceError(
      "composition-selection-invalid",
      "The native export selection is invalid.",
    );
  const roots = nodeIds.map((id) => {
    const matches = doc.querySelectorAll(
      `[data-agent-native-node-id="${CSS.escape(id)}"]`,
    );
    if (matches.length !== 1)
      throw new NativeSourceError(
        "composition-selection-stale",
        "A selected native export layer has no unique authored node.",
      );
    return matches[0]!;
  });
  for (const root of roots)
    for (
      let ancestor = root.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    )
      if (
        (ancestor.hasAttribute("data-an-native-fill-instance") ||
          ancestor.hasAttribute("data-an-native-layer-instance")) &&
        !roots.some(
          (selected) => selected === ancestor || selected.contains(ancestor),
        )
      )
        throw new NativeSourceError(
          "composition-selection-atomic-owner",
          "This selected layer is inside an atomic native output; select its native owner for export.",
        );
  return roots;
}

export function filterNativeExportSelection<
  Record extends { node: Element; nativeInstanceId?: string },
>(
  records: readonly Record[],
  roots: readonly Element[],
  nativeTarget: (instanceId: string) => Element,
): Record[] {
  return records.filter((record) => {
    const authoredNode = record.nativeInstanceId
      ? nativeTarget(record.nativeInstanceId)
      : record.node;
    return roots.some(
      (root) => root === authoredNode || root.contains(authoredNode),
    );
  });
}
