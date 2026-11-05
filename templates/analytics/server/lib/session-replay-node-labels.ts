const RRWEB_FULL_SNAPSHOT = 2;
const RRWEB_INCREMENTAL_SNAPSHOT = 3;
const SOURCE_MUTATION = 0;
const NODE_ELEMENT = 2;
const NODE_TEXT = 3;

const MAX_LABEL_CHARS = 80;
const MAX_ANCESTORS_CHECKED = 6;
const MAX_SHOWN_ERROR_CHARS = 500;
const TOAST_TEXT_JOINER = " — ";
// Recordings from before the recorder marked failed runs show only this copy.
const AGENT_RUN_ERROR_HEADINGS: ReadonlySet<string> = new Set([
  "The agent hit an error",
  "The agent run failed before it finished.",
  "The agent stopped before finishing",
]);
const NAMING_ATTRIBUTES = [
  "aria-label",
  "title",
  "placeholder",
  "alt",
  "name",
] as const;
const CONTROL_TAGS: ReadonlySet<string> = new Set([
  "a",
  "button",
  "input",
  "select",
  "summary",
  "textarea",
]);
const CONTROL_ROLES: ReadonlySet<string> = new Set([
  "button",
  "checkbox",
  "link",
  "menuitem",
  "option",
  "radio",
  "switch",
  "tab",
]);
const UNREADABLE_TEXT_TAGS: ReadonlySet<string> = new Set([
  "noscript",
  "option",
  "script",
  "style",
  "textarea",
]);
// The recorder replaces masked text with asterisks, which name nothing.
const MASKED_TEXT = /^[*\s]*$/;

interface ReplayNode {
  parentId: number | null;
  /** The role or tag name, when this node is something a person operates. */
  control: string | null;
  tag: string;
  name: string;
  toast: boolean;
  toastTitle: boolean;
  editable: boolean;
}

/** An error the person saw that neither the console nor the network reported. */
export interface ReplayShownError {
  kind: "error-toast" | "agent-error";
  label: string;
  detail: string | null;
}

function isEditableAttribute(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "false";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readableText(value: unknown, maxChars = MAX_LABEL_CHARS): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  if (MASKED_TEXT.test(text)) return "";
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function elementNode(
  serialized: Record<string, unknown>,
  parentId: number | null,
): ReplayNode {
  const tag = String(serialized.tagName ?? "").toLowerCase();
  const attributes = record(serialized.attributes);
  const role = String(attributes.role ?? "").toLowerCase();
  let name = "";
  for (const attribute of NAMING_ATTRIBUTES) {
    name = readableText(attributes[attribute]);
    if (name) break;
  }
  return {
    parentId,
    control: CONTROL_ROLES.has(role)
      ? role
      : CONTROL_TAGS.has(tag)
        ? tag
        : null,
    tag,
    name,
    toast: "data-sonner-toast" in attributes,
    toastTitle: "data-title" in attributes,
    editable: isEditableAttribute(attributes.contenteditable),
  };
}

/**
 * Names rrweb nodes from a replay's snapshots, so a step can say what a person
 * clicked rather than that they clicked. Names come from text and attributes
 * the replay already shows; input values never do.
 */
export function createReplayNodeLabels() {
  const nodes = new Map<number, ReplayNode>();
  const toastTexts = new Map<number, string[]>();

  function toastHolding(parentId: number | null): number | null {
    let id = parentId;
    for (
      let depth = 0;
      id !== null && depth < MAX_ANCESTORS_CHECKED;
      depth += 1
    ) {
      const node = nodes.get(id);
      if (!node) return null;
      if (node.toast) return id;
      id = node.parentId;
    }
    return null;
  }

  /** Whether text under this parent is the page's, not something being typed. */
  function holdsReadableText(parentId: unknown): boolean {
    let cursor = typeof parentId === "number" ? nodes.get(parentId) : undefined;
    if (!cursor || UNREADABLE_TEXT_TAGS.has(cursor.tag)) return false;
    while (cursor) {
      if (cursor.editable) return false;
      cursor =
        cursor.parentId === null ? undefined : nodes.get(cursor.parentId);
    }
    return true;
  }

  /** A control's text names it, wherever in the control the text sits. */
  function nameFromText(parentId: number | null, text: string): void {
    let cursor = parentId === null ? undefined : nodes.get(parentId);
    if (!cursor || !text) return;
    cursor.name ||= text;
    for (let depth = 0; cursor && depth < MAX_ANCESTORS_CHECKED; depth += 1) {
      if (cursor.control) {
        cursor.name ||= text;
        return;
      }
      cursor =
        cursor.parentId === null ? undefined : nodes.get(cursor.parentId);
    }
  }

  function addTree(root: unknown, rootParentId: number | null): void {
    const stack: Array<{ node: unknown; parentId: number | null }> = [
      { node: root, parentId: rootParentId },
    ];
    for (let entry = stack.pop(); entry; entry = stack.pop()) {
      const { node, parentId } = entry;
      const serialized = record(node);
      const id = serialized.id;
      if (typeof id !== "number") continue;
      if (serialized.type === NODE_TEXT) {
        if (holdsReadableText(parentId)) {
          const parent = parentId === null ? undefined : nodes.get(parentId);
          nameFromText(parentId, readableText(serialized.textContent));
          const toast = toastHolding(parentId);
          const text = readableText(
            serialized.textContent,
            MAX_SHOWN_ERROR_CHARS,
          );
          if (toast !== null && text) {
            const others = toastTexts.get(toast) ?? [];
            toastTexts.set(
              toast,
              parent?.toastTitle ? [text, ...others] : [...others, text],
            );
          }
        }
        continue;
      }
      if (serialized.type === NODE_ELEMENT) {
        nodes.set(id, elementNode(serialized, parentId));
      }
      if (!Array.isArray(serialized.childNodes)) continue;
      // Reversed so the first child's text is the one a parent keeps.
      for (let i = serialized.childNodes.length - 1; i >= 0; i -= 1) {
        stack.push({ node: serialized.childNodes[i], parentId: id });
      }
    }
  }

  function errorsShownBy(data: Record<string, unknown>): ReplayShownError[] {
    const adds = Array.isArray(data.adds) ? data.adds.map(record) : [];
    const changes = Array.isArray(data.attributes)
      ? data.attributes.map(record)
      : [];
    const errorToasts = new Set<number>();
    const texts: Array<{ parentId: unknown; text: string }> = [];
    for (const { node, parentId } of adds) {
      const serialized = record(node);
      if (
        serialized.type === NODE_ELEMENT &&
        typeof serialized.id === "number" &&
        nodes.get(serialized.id)?.toast &&
        record(serialized.attributes)["data-type"] === "error"
      ) {
        errorToasts.add(serialized.id);
      }
      const text =
        serialized.type === NODE_TEXT && holdsReadableText(parentId)
          ? readableText(serialized.textContent, MAX_SHOWN_ERROR_CHARS)
          : "";
      if (text) texts.push({ parentId, text });
    }
    for (const { id, attributes } of changes) {
      const node = typeof id === "number" ? nodes.get(id) : undefined;
      const changed = record(attributes);
      if (node && "contenteditable" in changed) {
        node.editable = isEditableAttribute(changed.contenteditable);
      }
      if (
        typeof id === "number" &&
        nodes.get(id)?.toast &&
        record(attributes)["data-type"] === "error"
      ) {
        errorToasts.add(id);
      }
    }

    const blockOf = (parentId: unknown) =>
      typeof parentId === "number" ? nodes.get(parentId)?.parentId : undefined;
    return [
      ...[...errorToasts].map(
        (id): ReplayShownError => ({
          kind: "error-toast",
          label: "Error toast",
          detail: toastTexts.get(id)?.join(TOAST_TEXT_JOINER) || null,
        }),
      ),
      ...texts
        .filter(({ text }) => AGENT_RUN_ERROR_HEADINGS.has(text))
        .map((heading): ReplayShownError => {
          const block = blockOf(heading.parentId);
          const message = texts.find(
            (other) => other !== heading && blockOf(other.parentId) === block,
          );
          return {
            kind: "agent-error",
            label: heading.text,
            detail: message?.text ?? null,
          };
        }),
    ];
  }

  return {
    /** Takes in one event, and returns the errors it put on screen. */
    observe(event: Record<string, unknown>): ReplayShownError[] {
      const data = record(event.data);
      if (event.type === RRWEB_FULL_SNAPSHOT) {
        addTree(data.node, null);
        return [];
      }
      if (
        event.type !== RRWEB_INCREMENTAL_SNAPSHOT ||
        data.source !== SOURCE_MUTATION
      ) {
        return [];
      }
      if (Array.isArray(data.adds)) {
        for (const add of data.adds) {
          const { node, parentId } = record(add);
          addTree(node, typeof parentId === "number" ? parentId : null);
        }
      }
      return errorsShownBy(data);
    },

    /** `button "Send"`, or null when the replay never named the node. */
    describe(id: unknown): string | null {
      if (typeof id !== "number") return null;
      let name = "";
      let control: string | null = null;
      let cursor = nodes.get(id);
      for (let depth = 0; cursor && depth < MAX_ANCESTORS_CHECKED; depth += 1) {
        name ||= cursor.name;
        if (cursor.control) {
          control = cursor.control;
          break;
        }
        cursor =
          cursor.parentId === null ? undefined : nodes.get(cursor.parentId);
      }
      if (!name) return null;
      return control ? `${control} "${name}"` : `"${name}"`;
    },
  };
}
