import { parse, type DefaultTreeAdapterTypes } from "parse5";

import {
  NATIVE_EFFECT_SCRIPT_TYPE,
  parseEffectsFromHtml,
  writeEffectsToHtml,
} from "./native-effects";

export class NativeEffectPruningError extends Error {
  readonly code = "native_effect_manifest_unreadable";

  constructor(errors: readonly string[]) {
    super(`Native effect manifest is unreadable: ${errors.join("; ")}`);
    this.name = "NativeEffectPruningError";
  }
}

function authoredNodeIds(html: string): Set<string> {
  const ids = new Set<string>();
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if ("tagName" in node) {
      if (node.tagName === "template") return;
      const id = node.attrs.find(
        (attr) => attr.name === "data-agent-native-node-id",
      )?.value;
      if (id) ids.add(id);
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(parse(html));
  return ids;
}

export function pruneDeletedNativeEffects(
  beforeHtml: string,
  afterHtml: string,
): string {
  if (
    !beforeHtml.includes(NATIVE_EFFECT_SCRIPT_TYPE) &&
    !afterHtml.includes(NATIVE_EFFECT_SCRIPT_TYPE)
  )
    return afterHtml;
  const before = parseEffectsFromHtml(beforeHtml);
  const after = parseEffectsFromHtml(afterHtml);
  if (before.errors.length || after.errors.length)
    throw new NativeEffectPruningError([...before.errors, ...after.errors]);
  if (!after.document?.instances.length) return afterHtml;
  const beforeIds = authoredNodeIds(beforeHtml);
  const afterIds = authoredNodeIds(afterHtml);
  const instances = after.document.instances.filter(
    (instance) =>
      !beforeIds.has(instance.nodeId) || afterIds.has(instance.nodeId),
  );
  if (instances.length === after.document.instances.length) return afterHtml;
  return writeEffectsToHtml(afterHtml, { ...after.document, instances });
}
