import type {
  PortableStyleSnapshot,
  PortableStyleSnapshotNode,
} from "@/components/design/types";

export function styleHost(element: Element): HTMLElement | SVGElement | null {
  return element instanceof HTMLElement || element instanceof SVGElement
    ? element
    : null;
}

export function elementAtPortableStylePath(
  root: Element,
  node: PortableStyleSnapshotNode,
): Element | null {
  let current: Element | null = root;
  for (const index of node.path) {
    if (!current || !Number.isInteger(index) || index < 0) return null;
    current = current.children.item(index);
  }
  return current;
}

const EDITOR_INTERNAL_CSS_VAR_PREFIXES = [
  "--design-editor-",
  "--agent-native-editor-chrome-",
  "--agent-native-",
];

export function isEditorInternalCssVar(property: string): boolean {
  return EDITOR_INTERNAL_CSS_VAR_PREFIXES.some((prefix) =>
    property.startsWith(prefix),
  );
}

export function applyPortableStyles(
  element: Element | null,
  styles: Record<string, string>,
) {
  if (!element) return;
  const host = styleHost(element);
  if (!host) return;
  Object.entries(styles).forEach(([property, value]) => {
    if (!value) return;
    if (property.startsWith("--")) {
      if (isEditorInternalCssVar(property)) return;
      host.style.setProperty(property, value);
      return;
    }
    if (property.includes("-")) {
      host.style.setProperty(property, value);
      return;
    }
    (host.style as any)[property] = value;
  });
}

export function sameStylesheetHead(
  sourceHtml: string,
  destHtml: string,
): boolean {
  if (typeof window === "undefined") return false;
  try {
    const parser = new DOMParser();
    const sourceHead = parser.parseFromString(sourceHtml, "text/html").head
      ?.innerHTML;
    const destHead = parser.parseFromString(destHtml, "text/html").head
      ?.innerHTML;
    return (
      typeof sourceHead === "string" &&
      typeof destHead === "string" &&
      sourceHead === destHead
    );
  } catch {
    return false;
  }
}

export function applyPortableStyleSnapshotToHtml(
  content: string,
  nodeAttrId: string,
  snapshot?: PortableStyleSnapshot,
  sourceContent?: string,
): string {
  if (typeof window === "undefined" || !snapshot?.nodes?.length) {
    return content;
  }
  if (sourceContent && sameStylesheetHead(sourceContent, content)) {
    return content;
  }
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const root = doc.querySelector(
      `[data-agent-native-node-id="${CSS.escape(nodeAttrId)}"]`,
    );
    if (!root) return content;
    let appliedAny = false;
    snapshot.nodes.forEach((node) => {
      const target = elementAtPortableStylePath(root, node);
      if (!target) return;
      const filteredEntries = Object.entries(node.styles).filter(
        ([property, value]) => value && !isEditorInternalCssVar(property),
      );
      if (filteredEntries.length === 0) return;
      applyPortableStyles(target, Object.fromEntries(filteredEntries));
      appliedAny = true;
    });
    if (appliedAny) {
      root.setAttribute("data-agent-native-preserve-styles", "true");
    }
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return content;
  }
}
