/**
 * The semantic snapshot of a rendered settings surface: for each row id, what
 * its control is and what state it is in, without anything a skin is free to
 * change. Two skins rendering the same sections must produce equal snapshots.
 *
 * A skin may draw a row as one element or as several (a frame, a control, a
 * summary), so the snapshot is keyed by row id and entity key, not by element.
 */
export interface SettingsSnapshotEntry {
  rid: string;
  key: string | null;
  part: string | null;
  role: string | null;
  name: string;
  enabled: boolean;
  /** `true`, `false` or `mixed` for a checked or pressed control. */
  checked: string | null;
  expanded: boolean | null;
  value: string | null;
  href: string | null;
  /** The computed summary shown with the row, when there is one. */
  summary: string | null;
  /** The live character counter, absent unless the model opts in. */
  counter: string | null;
  /** The message of a failed write shown with the row, when there is one. */
  error: string | null;
}

interface SettingsRowIdentity {
  rid: string;
  key: string | null;
}

export interface SettingsSkinChoice extends SettingsRowIdentity {
  referenceFamily: string;
  houseFamily: string;
  reason: string;
}

type SettingsObservedValue =
  | null
  | string
  | number
  | boolean
  | readonly SettingsObservedValue[]
  | { readonly [key: string]: SettingsObservedValue };

export interface SettingsChoiceWitness {
  value: string;
  label: string;
  enabled: boolean;
}

export type SettingsEffectWitness =
  | { kind: "write" | "action"; target: string; result: SettingsObservedValue }
  | { kind: "route" | "surface"; target: string };

/** Record each field from this skin's rendered controls or exercised journey. */
export interface SettingsBehaviorWitness extends SettingsRowIdentity {
  name: string;
  value: SettingsObservedValue;
  choices: readonly SettingsChoiceWitness[];
  enabled: boolean;
  checked: boolean | "mixed" | null;
  effect: SettingsEffectWitness | null;
  error: string | null;
  recovery: SettingsEffectWitness | null;
  keyboard: { reachable: boolean; operable: boolean };
}

export interface SettingsEquivalenceOptions {
  skinChoices?: readonly SettingsSkinChoice[];
  referenceWitnesses?: readonly SettingsBehaviorWitness[];
  houseWitnesses?: readonly SettingsBehaviorWitness[];
}

export interface SettingsEquivalenceResult {
  differences: string[];
  skinChoices: SettingsSkinChoice[];
}

const INTERACTIVE =
  'button, a[href], input, select, textarea, [role="switch"], [role="checkbox"], [role="radio"], [role="radiogroup"], [role="combobox"], [role="button"], [role="link"], [role="menuitem"], [role="tab"]';

/** Parts that frame or annotate a row and are never its control. */
const STRUCTURAL = new Set([
  "settings.row",
  "settings.custom-row",
  "settings.collection.item",
  "settings.dialog",
  "settings.row.summary",
  "settings.row.value",
  "settings.row.error",
  "settings.row.status",
  "settings.row.counter",
  "settings.row.disabled-reason",
  "settings.collection.empty",
  "settings.collection.error",
]);

function implicitRole(element: Element): string | null {
  const explicit = element.getAttribute("role");
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a" && element.hasAttribute("href")) return "link";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "number") return "spinbutton";
    if (type === "file") return "file";
    return "textbox";
  }
  return null;
}

/** Visible text: no style or script content, nothing hidden from assistive technology. */
function text(node: Node | null | undefined): string {
  if (!node) return "";
  let out = "";
  const walk = (current: Node) => {
    if (current.nodeType === 3) {
      out += current.nodeValue ?? "";
      return;
    }
    if (current.nodeType !== 1) return;
    const element = current as Element;
    const tag = element.tagName.toLowerCase();
    if (tag === "style" || tag === "script" || tag === "svg") return;
    if (element.getAttribute("aria-hidden") === "true") return;
    for (const child of element.childNodes) walk(child);
  };
  walk(node);
  return out.replace(/\s+/g, " ").trim();
}

function accessibleName(element: Element, root: ParentNode): string {
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const names = labelledBy
      .split(/\s+/)
      .map((id) => text(element.ownerDocument.getElementById(id)))
      .filter(Boolean);
    if (names.length > 0) return names.join(" ");
  }
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel?.trim()) return ariaLabel.trim();
  const id = element.getAttribute("id");
  if (id) {
    for (const label of root.querySelectorAll("label")) {
      if (label.getAttribute("for") === id) return text(label);
    }
  }
  const wrapping = element.closest("label");
  if (wrapping) return text(wrapping);
  const role = implicitRole(element);
  if (
    role === "button" ||
    role === "link" ||
    role === "radio" ||
    role === "menuitem" ||
    role === "tab"
  ) {
    return text(element);
  }
  return "";
}

function controlOf(element: Element): Element | null {
  if (element.matches(INTERACTIVE)) return element;
  return element.querySelector(INTERACTIVE);
}

/** Reads every row id under `root`, in document order of first appearance. */
export function snapshotSettings(root: ParentNode): SettingsSnapshotEntry[] {
  const groups = new Map<
    string,
    { element: Element; rid: string; part: string; key: string | null }[]
  >();
  for (const element of root.querySelectorAll("[data-rid]")) {
    const rids = (element.getAttribute("data-rid") ?? "").split(/\s+/);
    const parts = (element.getAttribute("data-part") ?? "").split(/\s+/);
    if (rids.length !== parts.length)
      throw new Error("Settings identities need one explicit part per row id");
    for (const [offset, rid] of rids.entries()) {
      const key = element.getAttribute("data-rid-key");
      const id = `${rid}\u0000${key ?? ""}`;
      const part = parts[offset];
      if (part === undefined) throw new Error("Missing settings identity part");
      const tagged = { element, rid, part, key };
      const list = groups.get(id);
      if (list) list.push(tagged);
      else groups.set(id, [tagged]);
    }
  }
  const entries: SettingsSnapshotEntry[] = [];
  for (const tagged of groups.values()) {
    const elements = tagged.map(({ element }) => element);
    const first = tagged[0]!;
    const partsByElement = new Map(
      tagged.map(({ element, part }) => [element, part]),
    );
    const partOf = (element: Element) => partsByElement.get(element) ?? "";
    let target: Element | null = null;
    let owner =
      elements.find((element) => partOf(element) === "settings.row.control") ??
      first.element;
    for (const element of elements) {
      if (STRUCTURAL.has(partOf(element))) continue;
      target = controlOf(element);
      if (target) {
        owner = element;
        break;
      }
    }
    const textOfPart = (part: string) => {
      const element = elements.find((candidate) => partOf(candidate) === part);
      return element ? text(element) : null;
    };
    const actionError = elements.find(
      (element) =>
        partOf(element) === "settings.collection.action" &&
        element.getAttribute("role") === "alert",
    );
    const base = {
      rid: first.rid,
      key: first.key,
      part: partOf(owner) || null,
      summary: textOfPart("settings.row.summary"),
      counter: textOfPart("settings.row.counter"),
      error:
        textOfPart("settings.row.error") ??
        textOfPart("settings.collection.error") ??
        (actionError ? text(actionError) : null),
    };
    if (!target) {
      entries.push({
        ...base,
        role: null,
        name: "",
        enabled: true,
        checked: null,
        expanded: null,
        value:
          textOfPart("settings.row.value") ??
          textOfPart("settings.collection.empty"),
        href: null,
      });
      continue;
    }
    const role = implicitRole(target);
    const checkedAttr =
      target.getAttribute("aria-checked") ??
      target.getAttribute("aria-pressed");
    const nativeChecked =
      target instanceof HTMLInputElement &&
      (target.type === "checkbox" || target.type === "radio")
        ? String(target.checked)
        : null;
    const expanded = target.getAttribute("aria-expanded");
    const hasValue =
      (target instanceof HTMLInputElement && target.type !== "file") ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;
    entries.push({
      ...base,
      role,
      name: accessibleName(target, root),
      enabled: !(
        target.hasAttribute("disabled") ||
        target.getAttribute("aria-disabled") === "true" ||
        target.hasAttribute("data-disabled")
      ),
      checked: checkedAttr ?? nativeChecked,
      expanded: expanded === null ? null : expanded === "true",
      value:
        hasValue && nativeChecked === null
          ? (target as HTMLInputElement).value
          : role === "combobox"
            ? text(target)
            : textOfPart("settings.row.value"),
      href: target.getAttribute("href"),
    });
  }
  return entries;
}

const FIELDS = [
  "part",
  "role",
  "name",
  "enabled",
  "checked",
  "expanded",
  "value",
  "href",
  "summary",
  "counter",
  "error",
] as const;

function comparable(value: string | boolean | null): string | boolean | null {
  // Skins space text differently; the words are what must match.
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : value;
}

const identity = ({ rid, key }: SettingsRowIdentity) =>
  JSON.stringify([rid, key]);
const label = ({ rid, key }: SettingsRowIdentity) =>
  key === null ? rid : `${rid} [${key}]`;
const index = <Entry extends SettingsRowIdentity>(entries: readonly Entry[]) =>
  new Map(entries.map((entry) => [identity(entry), entry]));

function diffSnapshotRows(
  reference: readonly SettingsSnapshotEntry[],
  house: readonly SettingsSnapshotEntry[],
  compare: (
    entry: SettingsSnapshotEntry,
    other: SettingsSnapshotEntry,
    differences: string[],
  ) => void,
  compareGlobalOrder: boolean,
): string[] {
  const a = index(reference);
  const b = index(house);
  const out: string[] = [];
  for (const [key, entry] of a) {
    const other = b.get(key);
    if (!other) {
      out.push(`missing in house: ${label(entry)}`);
      continue;
    }
    compare(entry, other, out);
  }
  for (const [key, entry] of b) {
    if (!a.has(key)) out.push(`missing in reference: ${label(entry)}`);
  }

  // Keep the existing cross-part diagnostic while the registered differences
  // are under review. Part-scoped ordering is reported independently below.
  const sharedOrder = (
    entries: readonly SettingsSnapshotEntry[],
    other: Map<string, SettingsSnapshotEntry>,
  ) => entries.map(identity).filter((key) => other.has(key));
  if (
    compareGlobalOrder &&
    JSON.stringify(sharedOrder(reference, b)) !==
      JSON.stringify(sharedOrder(house, a))
  ) {
    out.push("order differs");
  }

  function orderByPart(
    entries: readonly SettingsSnapshotEntry[],
    other: Map<string, SettingsSnapshotEntry>,
  ) {
    const parts = new Map<string | null, string[]>();
    for (const entry of entries) {
      const key = identity(entry);
      const counterpart = other.get(key);
      if (!counterpart || counterpart.part !== entry.part) continue;
      const order = parts.get(entry.part);
      if (order) order.push(key);
      else parts.set(entry.part, [key]);
    }
    return parts;
  }
  const referenceOrder = orderByPart(reference, b);
  const houseOrder = orderByPart(house, a);
  for (const [part, order] of referenceOrder) {
    if (JSON.stringify(order) !== JSON.stringify(houseOrder.get(part))) {
      out.push(`order differs within ${part ?? "(untagged part)"}`);
    }
  }
  return out;
}

function diffField(
  row: SettingsRowIdentity,
  field: string,
  reference: unknown,
  house: unknown,
  differences: string[],
) {
  differences.push(
    `${label(row)}: ${field} ${JSON.stringify(reference)} (reference) vs ${JSON.stringify(house)} (house)`,
  );
}

function diffDomFields(
  entry: SettingsSnapshotEntry,
  other: SettingsSnapshotEntry,
  fields: readonly (typeof FIELDS)[number][],
  differences: string[],
) {
  for (const field of fields) {
    if (comparable(entry[field]) !== comparable(other[field])) {
      diffField(entry, field, entry[field], other[field], differences);
    }
  }
}

/** Keep the original DOM diagnostics available for existing snapshot suites. */
export function diffSettingsSnapshots(
  reference: readonly SettingsSnapshotEntry[],
  house: readonly SettingsSnapshotEntry[],
): string[] {
  return diffSnapshotRows(
    reference,
    house,
    (entry, other, differences) =>
      diffDomFields(entry, other, FIELDS, differences),
    true,
  );
}

function serializeObservedValue(value: SettingsObservedValue): string {
  return JSON.stringify(value, (_, node: SettingsObservedValue) => {
    if (node === null || typeof node !== "object" || Array.isArray(node)) {
      return node;
    }
    return Object.fromEntries(
      Object.entries(node).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  });
}

function observedFields(witness: SettingsBehaviorWitness) {
  const choices = witness.choices
    .map(({ value, label, enabled }) => ({
      value,
      label: comparable(label),
      enabled,
    }))
    .sort((a, b) => {
      const left = serializeObservedValue(a);
      const right = serializeObservedValue(b);
      return left < right ? -1 : left > right ? 1 : 0;
    });
  return {
    name: comparable(witness.name),
    value: witness.value,
    choices,
    enabled: witness.enabled,
    checked: witness.checked,
    keyboard: witness.keyboard,
    effect: witness.effect,
    error: comparable(witness.error),
    recovery: witness.recovery,
  } satisfies Record<string, SettingsObservedValue>;
}

function diffBehavior(
  reference: SettingsBehaviorWitness,
  house: SettingsBehaviorWitness,
  differences: string[],
) {
  const a = Object.entries(observedFields(reference));
  const b = new Map(Object.entries(observedFields(house)));
  for (const [field, value] of a) {
    const other = b.get(field);
    if (
      other === undefined ||
      serializeObservedValue(value) !== serializeObservedValue(other)
    ) {
      diffField(reference, field, value, other, differences);
    }
  }
  for (const [skin, witness] of [
    ["reference", reference],
    ["house", house],
  ] as const) {
    if (
      witness.enabled &&
      (!witness.keyboard.reachable || !witness.keyboard.operable)
    ) {
      differences.push(
        `${label(witness)}: keyboard could not reach and operate the row in ${skin}`,
      );
    }
  }
}

function indexEvidence<Entry extends SettingsRowIdentity>(
  entries: readonly Entry[],
  description: string,
): Map<string, Entry> {
  const result = index(entries);
  if (result.size !== entries.length) {
    throw new Error(`Duplicate row identity in ${description}`);
  }
  return result;
}

/**
 * Compare row identity and behavior across skins. A declared family difference
 * replaces the control's DOM readings with observations from both journeys.
 */
export function compareSettingsSnapshots(
  reference: readonly SettingsSnapshotEntry[],
  house: readonly SettingsSnapshotEntry[],
  options: SettingsEquivalenceOptions = {},
): SettingsEquivalenceResult {
  const choices = indexEvidence(options.skinChoices ?? [], "skin choices");
  for (const choice of choices.values()) {
    if (
      !choice.reason.trim() ||
      !choice.referenceFamily.trim() ||
      !choice.houseFamily.trim() ||
      choice.referenceFamily.trim() === choice.houseFamily.trim()
    ) {
      throw new Error(
        `${label(choice)}: a skin choice needs two distinct families and a reason`,
      );
    }
  }
  const referenceWitnesses = indexEvidence(
    options.referenceWitnesses ?? [],
    "reference witnesses",
  );
  const houseWitnesses = indexEvidence(
    options.houseWitnesses ?? [],
    "house witnesses",
  );
  const skinChoices: SettingsSkinChoice[] = [];
  const differences = diffSnapshotRows(
    reference,
    house,
    (entry, other, out) => {
      const key = identity(entry);
      const choice = choices.get(key);
      const a = referenceWitnesses.get(key);
      const b = houseWitnesses.get(key);
      if (choice) skinChoices.push(choice);

      if (!a || !b) {
        if (choice || a || b) {
          out.push(
            `${label(entry)}: missing ${!a && !b ? "reference and house" : a ? "house" : "reference"} behavior witness`,
          );
        }
        diffDomFields(entry, other, FIELDS, out);
        return;
      }

      diffDomFields(
        entry,
        other,
        choice ? ["part", "counter"] : ["part", "role", "expanded", "counter"],
        out,
      );
      diffBehavior(a, b, out);
    },
    false,
  );

  for (const [skin, rows, witnesses] of [
    ["reference", reference, referenceWitnesses],
    ["house", house, houseWitnesses],
  ] as const) {
    const rendered = index(rows);
    for (const [key, witness] of witnesses) {
      if (!rendered.has(key)) {
        differences.push(
          `${label(witness)}: ${skin} behavior witness has no rendered row`,
        );
      }
    }
  }

  return { differences, skinChoices };
}
