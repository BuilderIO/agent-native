/**
 * How a source adapter finds a picked DOM node again after its container
 * re-renders, for content whose nodes carry no stable id (slide HTML, rich
 * text blocks).
 */
export interface AgentSelectNodeIdentity {
  /** `:nth-child` steps from the container to the node. */
  path: string;
  fingerprint: string;
  /** The fingerprints of the node's neighbours when it was picked. */
  previous: string;
  next: string;
}

/** What a node looks like, to recognise it again by position. */
function fingerprint(element: Element | null): string {
  if (!element) return "";
  return [
    element.tagName,
    element.textContent.replace(/\s+/g, " ").trim(),
    element.getAttribute("src") ?? "",
  ].join("\u0000");
}

/** A CSS path from `root`, stable while the content under it is unchanged. */
export function agentSelectNodePath(element: Element, root: Element): string {
  const steps: string[] = [];
  let current = element;
  while (current !== root) {
    const parent = current.parentElement;
    if (!parent) break;
    const index = Array.from(parent.children).indexOf(current) + 1;
    steps.unshift(`${current.tagName.toLowerCase()}:nth-child(${index})`);
    current = parent;
  }
  return steps.join(" > ");
}

export function agentSelectNodeIdentity(
  element: Element,
  root: Element,
): AgentSelectNodeIdentity {
  return {
    path: agentSelectNodePath(element, root),
    fingerprint: fingerprint(element),
    previous: fingerprint(element.previousElementSibling),
    next: fingerprint(element.nextElementSibling),
  };
}

/**
 * The picked node under `root`, or null when it is gone. A positional path
 * can land on a neighbour once a sibling is removed, so the path is trusted
 * when the node there still looks like the picked one, or when it was edited
 * in place: same tag between the same, unchanged neighbours. Otherwise the
 * node is searched for by its look.
 */
export function findAgentSelectNode(
  root: Element,
  identity: AgentSelectNodeIdentity,
): HTMLElement | null {
  const atPath = identity.path
    ? root.querySelector<HTMLElement>(`:scope > ${identity.path}`)
    : null;
  if (atPath && fingerprint(atPath) === identity.fingerprint) return atPath;
  const tag = identity.fingerprint.slice(
    0,
    identity.fingerprint.indexOf("\u0000"),
  );
  if (!tag) return null;
  for (const candidate of root.querySelectorAll<HTMLElement>(tag)) {
    if (fingerprint(candidate) === identity.fingerprint) return candidate;
  }
  if (
    atPath?.tagName === tag &&
    fingerprint(atPath.previousElementSibling) === identity.previous &&
    fingerprint(atPath.nextElementSibling) === identity.next
  ) {
    return atPath;
  }
  return null;
}
