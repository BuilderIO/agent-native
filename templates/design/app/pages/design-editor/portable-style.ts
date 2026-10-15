import { resolveLayerNameAttribute } from "@shared/layer-name";

import type {
  PortableStyleSnapshot,
  PortableStyleSnapshotNode,
} from "@/components/design/types";

export function styleHost(element: Element): HTMLElement | SVGElement | null {
  const view = element.ownerDocument.defaultView;
  const HTMLElementConstructor = view?.HTMLElement ?? HTMLElement;
  const SVGElementConstructor = view?.SVGElement ?? SVGElement;
  return element instanceof HTMLElementConstructor ||
    element instanceof SVGElementConstructor
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

const DROP_OWNED_STYLE_PROPERTIES = new Set(["position"]);
// The moved root's flex sizing belongs to its new parent; the move fits it.
const DROP_OWNED_ROOT_STYLE_PROPERTIES = new Set([
  "flex",
  "flexBasis",
  "flexGrow",
  "flexShrink",
]);

function cssPropertyName(property: string): string {
  if (property.includes("-")) return property;
  const kebab = property.replace(
    /[A-Z]/g,
    (letter) => `-${letter.toLowerCase()}`,
  );
  return kebab.startsWith("webkit-") ? `-${kebab}` : kebab;
}

const longhandsByProperty = new Map<string, string[]>();

function longhandsOf(document: Document, property: string): string[] {
  let longhands = longhandsByProperty.get(property);
  if (!longhands) {
    const probe = document.createElement("div").style;
    probe.setProperty(property, "initial");
    longhands = probe.length > 0 ? Array.from(probe) : [property];
    longhandsByProperty.set(property, longhands);
  }
  return longhands;
}

export function applyPortableStyles(
  element: Element | null,
  styles: Record<string, string>,
) {
  if (!element) return;
  const host = styleHost(element);
  if (!host) return;
  const authored = (host.cloneNode(false) as HTMLElement | SVGElement).style;
  const authoredWithoutVar = (longhand: string) => {
    const value = authored.getPropertyValue(longhand);
    return Boolean(value) && !value.includes("var(");
  };
  Object.entries(styles).forEach(([property, value]) => {
    if (!value) return;
    if (DROP_OWNED_STYLE_PROPERTIES.has(property)) return;
    if (property.startsWith("--")) {
      if (isEditorInternalCssVar(property)) return;
      host.style.setProperty(property, value);
      return;
    }
    // The layer's own declarations travel with it (unless they read a var() the
    // destination may lack); a partly authored shorthand still carries what it inherited.
    if (
      longhandsOf(host.ownerDocument, cssPropertyName(property)).every(
        authoredWithoutVar,
      )
    ) {
      return;
    }
    if (property.includes("-")) {
      host.style.setProperty(property, value);
      return;
    }
    (host.style as any)[property] = value;
  });
}

export function applyPortableStyleSnapshotToHtml(
  content: string,
  nodeAttrId: string,
  snapshot?: PortableStyleSnapshot,
): string {
  if (typeof window === "undefined" || !snapshot?.nodes?.length) {
    return content;
  }
  // Equal heads do not guarantee equal body/ancestor cascades.
  // ponytail: inline snapshots may mask later responsive stylesheet rules.
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
        ([property, value]) =>
          value &&
          !isEditorInternalCssVar(property) &&
          !DROP_OWNED_STYLE_PROPERTIES.has(property) &&
          !(
            node.path.length === 0 &&
            DROP_OWNED_ROOT_STYLE_PROPERTIES.has(property)
          ),
      );
      if (filteredEntries.length === 0) return;
      applyPortableStyles(target, Object.fromEntries(filteredEntries));
      appliedAny = true;
    });
    if (appliedAny) {
      const layerName =
        resolveLayerNameAttribute((attribute) => root.getAttribute(attribute))
          ?.value ?? "";
      const nodeId = root.getAttribute("data-agent-native-node-id") || "";
      const legacyGeneratedGroup =
        /^an-[a-z0-9]+$/i.test(nodeId) &&
        /^group(?: \d+)?$/i.test(layerName.trim()) &&
        root.getAttribute("data-agent-native-preserve-styles") === "true" &&
        root.getAttribute("data-agent-native-clone-root") !== "true";
      root.setAttribute("data-agent-native-preserve-styles", "true");
      if (
        root.getAttribute("data-agent-native-group-wrapper") !== "true" &&
        !legacyGeneratedGroup
      ) {
        root.setAttribute("data-agent-native-clone-root", "true");
      }
    }
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return content;
  }
}
