/**
 * Three-way merge of slide HTML so two collaborators editing different objects
 * on the same slide both keep their work. `base` is the content both sides
 * started from, `local` the caller's unsaved draft, `remote` the saved copy
 * another writer produced.
 *
 * Returns the merged HTML, or `null` when the edits overlap (same text node,
 * same attribute, one side deleting what the other edited) or the markup
 * cannot be aligned. A `null` is a real conflict the caller must surface; this
 * never picks a side.
 */
export function mergeSlideContent(
  base: string,
  local: string,
  remote: string,
): string | null {
  if (local === remote) return local;
  if (base === remote) return local;
  if (base === local) return remote;
  if (typeof document === "undefined") return null;

  const parse = (html: string) => {
    const template = document.createElement("template");
    template.innerHTML = html;
    return Array.from(template.content.childNodes);
  };
  const merged = mergeChildren(parse(base), parse(local), parse(remote));
  if (!merged) return null;

  const out = document.createElement("template");
  for (const node of merged) out.content.appendChild(node);
  return out.innerHTML;
}

function signature(node: Node): string {
  if (node instanceof Element) return node.outerHTML;
  if (node.nodeType === Node.TEXT_NODE) return `#text:${node.nodeValue}`;
  return `#${node.nodeType}:${node.nodeValue}`;
}

function nodeKeys(nodes: Node[]): string[] | null {
  const ordinals = new Map<string, number>();
  const keys = nodes.map((node) => {
    const objectId =
      node instanceof Element
        ? node.getAttribute("data-slide-object-id")
        : null;
    if (objectId) return `o:${objectId}`;
    const kind = node instanceof Element ? node.tagName : `#${node.nodeType}`;
    const ordinal = ordinals.get(kind) ?? 0;
    ordinals.set(kind, ordinal + 1);
    return `${kind}:${ordinal}`;
  });
  return new Set(keys).size === keys.length ? keys : null;
}

function sameSequence(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

function mergeChildren(
  base: Node[],
  local: Node[],
  remote: Node[],
): Node[] | null {
  const baseKeys = nodeKeys(base);
  const localKeys = nodeKeys(local);
  const remoteKeys = nodeKeys(remote);
  if (!baseKeys || !localKeys || !remoteKeys) return null;

  const byKey = (nodes: Node[], keys: string[]) =>
    new Map(keys.map((key, index) => [key, nodes[index]]));
  const baseNodes = byKey(base, baseKeys);
  const localNodes = byKey(local, localKeys);
  const remoteNodes = byKey(remote, remoteKeys);

  const common = (keys: string[], other: Map<string, Node>) =>
    keys.filter((key) => other.has(key));
  const localReordered = !sameSequence(
    common(baseKeys, localNodes),
    common(localKeys, baseNodes),
  );
  const remoteReordered = !sameSequence(
    common(baseKeys, remoteNodes),
    common(remoteKeys, baseNodes),
  );
  if (localReordered && remoteReordered) return null;

  const resolved = new Map<string, Node | null>();
  for (const key of new Set([...baseKeys, ...localKeys, ...remoteKeys])) {
    const b = baseNodes.get(key);
    const l = localNodes.get(key);
    const r = remoteNodes.get(key);
    if (b) {
      if (l && r) {
        const node = mergeNode(b, l, r);
        if (!node) return null;
        resolved.set(key, node);
      } else {
        // Deleted on one side: only safe when the other side left it alone.
        const survivor = l ?? r;
        if (survivor && signature(survivor) !== signature(b)) return null;
        resolved.set(key, null);
      }
    } else if (l && r) {
      if (signature(l) !== signature(r)) return null;
      resolved.set(key, l);
    } else {
      resolved.set(key, (l ?? r) as Node);
    }
  }

  // The side that reordered supplies the order; the other side's additions and
  // deletions are folded into it.
  const [primary, secondary] = localReordered
    ? [localKeys, remoteKeys]
    : [remoteKeys, localKeys];
  const order = primary.filter((key) => resolved.get(key));
  for (const [index, key] of secondary.entries()) {
    if (!resolved.get(key) || order.includes(key)) continue;
    let anchor = -1;
    for (let i = index - 1; i >= 0 && anchor < 0; i--) {
      anchor = order.indexOf(secondary[i]);
    }
    order.splice(anchor + 1, 0, key);
  }
  return order.map((key) => resolved.get(key)!.cloneNode(true));
}

function mergeNode(base: Node, local: Node, remote: Node): Node | null {
  const sb = signature(base);
  const sl = signature(local);
  const sr = signature(remote);
  if (sl === sb || sl === sr) return remote;
  if (sr === sb) return local;
  if (
    !(base instanceof Element) ||
    !(local instanceof Element) ||
    !(remote instanceof Element) ||
    base.tagName !== local.tagName ||
    base.tagName !== remote.tagName
  ) {
    return null;
  }

  const element = remote.cloneNode(false) as Element;
  for (const name of new Set([
    ...base.getAttributeNames(),
    ...local.getAttributeNames(),
    ...remote.getAttributeNames(),
  ])) {
    const value = mergeAttribute(
      name,
      base.getAttribute(name),
      local.getAttribute(name),
      remote.getAttribute(name),
    );
    if (value === undefined) return null;
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }

  const children = mergeChildren(
    Array.from(base.childNodes),
    Array.from(local.childNodes),
    Array.from(remote.childNodes),
  );
  if (!children) return null;
  element.replaceChildren(...children);
  return element;
}

/** `undefined` means both sides changed the attribute differently. */
function mergeAttribute(
  name: string,
  base: string | null,
  local: string | null,
  remote: string | null,
): string | null | undefined {
  if (local === remote || base === remote) return local;
  if (base === local) return remote;
  if (name !== "style" || base === null || local === null || remote === null) {
    return undefined;
  }

  const b = parseStyle(base);
  const l = parseStyle(local);
  const r = parseStyle(remote);
  const merged = new Map(r);
  for (const property of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
    const value = mergeAttribute(
      property,
      b.get(property) ?? null,
      l.get(property) ?? null,
      r.get(property) ?? null,
    );
    if (value === undefined) return undefined;
    if (value === null) merged.delete(property);
    else merged.set(property, value);
  }
  return Array.from(merged, ([property, value]) => `${property}: ${value}`)
    .join("; ")
    .concat(merged.size > 0 ? ";" : "");
}

function parseStyle(style: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const declaration of style.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    declarations.set(
      declaration.slice(0, separator).trim().toLowerCase(),
      declaration.slice(separator + 1).trim(),
    );
  }
  return declarations;
}
