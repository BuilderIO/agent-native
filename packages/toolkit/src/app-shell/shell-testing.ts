import type { ShellSubPart, ShellValue } from "./contracts.js";

export interface ShellSnapshotIdentity {
  id: string;
  entityKey?: string | undefined;
}
export interface ShellSemanticSnapshot extends ShellSnapshotIdentity {
  part: ShellSubPart;
  containerId: string;
  order: number;
  present: boolean;
  family: string;
  role: string | null;
  expanded: boolean | null;
  name: string;
  value: ShellValue;
  choices: readonly { value: string; label: string; enabled: boolean }[];
  enabled: boolean;
  selected: boolean | null;
  checked: boolean | "mixed" | null;
  shortcut: string | null;
  /** Independently observed images, in DOM order, including decorative images.
   * Omitted means none; null alt distinguishes a missing attribute from alt="".
   * URLs and pixels are appearance, not semantic observations. */
  images?: readonly { alt: string | null }[];
  /** Optional symbol observations, including a leading search icon. */
  symbols?: readonly { key: string; fallback: boolean }[];
  surfaceOwner?: "house" | "content";
  keyboardOwner?: string;
  current?: string | null;
  activationOwner?: "house" | "content";
  editorOwner?: string;
  navigationOwner?: string;
  compositionOwner?: string;
  annotations?: { current: boolean; pinned: boolean };
  rootPreferences?: { pointerCursors: boolean; underlineLinks: boolean };
  badge: {
    kind: "count" | "dot" | "text";
    value: number | string | null;
    accessibleLabel: string | null;
  } | null;
  effect: {
    kind: "route" | "action" | "write" | "surface" | "external" | "none";
    target: string | null;
    result: ShellValue;
  };
  read: {
    status: "ready" | "loading" | "error";
    message: string | null;
    recovery: string | null;
  };
  action: { pending: boolean; error: string | null; recovery: string | null };
  keyboard: { reachable: boolean; operable: boolean };
}
export interface ShellLookChoice extends ShellSnapshotIdentity {
  sourceFamily: string;
  houseFamily: string;
  reason: string;
}
export interface ShellPlacementDeviation extends ShellSnapshotIdentity {
  sourceContainer: string;
  houseContainer: string;
  reason: string;
}
const identityKey = (value: ShellSnapshotIdentity) =>
  JSON.stringify([value.id, value.entityKey ?? null]);
const text = (value: string) => value.replace(/\s+/g, " ").trim();
function hasPlainPrototype(
  value: object,
  builtin: ObjectConstructor | ArrayConstructor,
): boolean {
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null) return builtin === Object;
  const constructor = Object.getOwnPropertyDescriptor(
    prototype,
    "constructor",
  )?.value;
  return (
    typeof constructor === "function" &&
    Object.getOwnPropertyDescriptor(constructor, "prototype")?.value ===
      prototype &&
    Function.prototype.toString.call(constructor) ===
      Function.prototype.toString.call(builtin)
  );
}
function assertComparable(
  value: unknown,
  path: string,
  ancestors = new Set<object>(),
  optionalKeys: readonly string[] = [],
): void {
  const invalid = (reason: string): never => {
    throw new Error(`Invalid snapshot ${path}: ${reason}`);
  };
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid("non-finite number");
    return;
  }
  if (typeof value !== "object") return invalid(`unsupported ${typeof value}`);
  const object = value;
  const array = Array.isArray(object);
  if (!hasPlainPrototype(object, array ? Array : Object))
    invalid("expected a plain record or array");
  if (ancestors.has(object)) invalid("cyclic value");
  ancestors.add(object);
  const keys = Reflect.ownKeys(object);
  if (array && keys.length !== object.length + 1)
    invalid("sparse or extended array");
  for (const key of keys) {
    if (array && key === "length") continue;
    if (typeof key !== "string") invalid("symbol key");
    if (
      array &&
      (String(Number(key)) !== key ||
        !Number.isInteger(Number(key)) ||
        Number(key) < 0 ||
        Number(key) >= object.length)
    )
      invalid("extended array");
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      return invalid("expected enumerable data properties");
    if (descriptor.value === undefined && optionalKeys.includes(String(key)))
      continue;
    assertComparable(descriptor.value, `${path}.${String(key)}`, ancestors);
  }
  ancestors.delete(object);
}
function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.keys(a);
  const right = Object.keys(b);
  return (
    left.length === right.length &&
    left.every(
      (key) =>
        Object.hasOwn(b, key) &&
        equal(Reflect.get(a, key), Reflect.get(b, key)),
    )
  );
}
function unique<T extends ShellSnapshotIdentity>(
  entries: readonly T[],
): Map<string, T> {
  const map = new Map<string, T>();
  for (const entry of entries) {
    const key = identityKey(entry);
    assertComparable(entry, key, new Set(), [
      "entityKey",
      "images",
      "symbols",
      "surfaceOwner",
      "keyboardOwner",
      "current",
      "activationOwner",
      "editorOwner",
      "navigationOwner",
      "compositionOwner",
      "annotations",
      "rootPreferences",
    ]);
    if (map.has(key)) throw new Error(`Duplicate visible identity: ${key}`);
    map.set(key, entry);
  }
  return map;
}
/** Entries come from independently read DOM/journeys in each look, never the shared model. */
export function compareShellSnapshots(
  source: readonly ShellSemanticSnapshot[],
  house: readonly ShellSemanticSnapshot[],
  options: {
    lookChoices?: readonly ShellLookChoice[];
    placements?: readonly ShellPlacementDeviation[];
  } = {},
) {
  const left = unique(source);
  const right = unique(house);
  const choices = unique(options.lookChoices ?? []);
  const placements = unique(options.placements ?? []);
  const differences: string[] = [];
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(key);
    const b = right.get(key);
    if (!a || !b) {
      differences.push(`${key}: missing in ${a ? "house" : "source"}`);
      continue;
    }
    const choice = choices.get(key);
    const familyChange = a.family !== b.family;
    const accepted =
      choice &&
      text(choice.reason) &&
      choice.sourceFamily === a.family &&
      choice.houseFamily === b.family;
    if (familyChange && !accepted)
      differences.push(`${key}: unregistered control family`);
    for (const field of [
      "present",
      "part",
      "name",
      "value",
      "enabled",
      "selected",
      "checked",
      "shortcut",
      "badge",
      "effect",
      "read",
      "action",
      "keyboard",
      "symbols",
      "surfaceOwner",
      "keyboardOwner",
      "current",
      "activationOwner",
      "editorOwner",
      "navigationOwner",
      "compositionOwner",
      "annotations",
      "rootPreferences",
    ] as const) {
      if (
        !(field === "name"
          ? text(a.name) === text(b.name)
          : equal(a[field], b[field]))
      )
        differences.push(`${key}: ${field}`);
    }
    if (!familyChange)
      for (const field of ["role", "expanded"] as const) {
        if (!equal(a[field], b[field])) differences.push(`${key}: ${field}`);
      }
    if (!equal(a.choices, b.choices)) differences.push(`${key}: choices`);
    if (!equal(a.images ?? [], b.images ?? []))
      differences.push(`${key}: images`);
    if (a.containerId !== b.containerId) {
      const deviation = placements.get(key);
      if (
        !deviation ||
        !text(deviation.reason) ||
        deviation.sourceContainer !== a.containerId ||
        deviation.houseContainer !== b.containerId
      )
        differences.push(`${key}: container`);
    }
  }
  for (const container of new Set(source.map((entry) => entry.containerId))) {
    const order = (entries: readonly ShellSemanticSnapshot[]) =>
      entries
        .filter(
          (entry) =>
            entry.present &&
            entry.containerId === container &&
            !placements.has(identityKey(entry)),
        )
        .sort((a, b) => a.order - b.order)
        .map(identityKey);
    if (!equal(order(source), order(house)))
      differences.push(`${container}: order`);
  }
  for (const [key, choice] of choices) {
    const a = left.get(key);
    const b = right.get(key);
    if (
      !text(choice.reason) ||
      !a ||
      !b ||
      choice.sourceFamily !== a.family ||
      choice.houseFamily !== b.family ||
      a.family === b.family
    )
      differences.push(`${key}: invalid look-choice witness`);
  }
  for (const [key, placement] of placements) {
    const a = left.get(key);
    const b = right.get(key);
    if (
      !text(placement.reason) ||
      !a ||
      !b ||
      a.containerId !== placement.sourceContainer ||
      b.containerId !== placement.houseContainer ||
      a.containerId === b.containerId
    )
      differences.push(`${key}: invalid placement witness`);
  }
  return { differences, lookChoices: [...choices.values()] };
}
export function shellTags(
  identity: ShellSnapshotIdentity,
  part: ShellSubPart,
  containerId: string,
): Record<string, string> {
  return {
    "data-rid": identity.id,
    "data-part": part,
    "data-rid-container": containerId,
    ...(identity.entityKey === undefined
      ? {}
      : { "data-rid-key": identity.entityKey }),
  };
}
const SHELL_ROLES: Readonly<
  Record<
    string,
    | "widget"
    | "structure"
    | "grid-header"
    | "choice-list"
    | "choice-radio"
    | "choice-input"
  >
> = {
  "doc-abstract": "structure",
  "doc-acknowledgments": "structure",
  "doc-afterword": "structure",
  "doc-appendix": "structure",
  "doc-backlink": "widget",
  "doc-biblioentry": "structure",
  "doc-bibliography": "structure",
  "doc-biblioref": "widget",
  "doc-chapter": "structure",
  "doc-colophon": "structure",
  "doc-conclusion": "structure",
  "doc-cover": "structure",
  "doc-credit": "structure",
  "doc-credits": "structure",
  "doc-dedication": "structure",
  "doc-endnote": "structure",
  "doc-endnotes": "structure",
  "doc-epigraph": "structure",
  "doc-epilogue": "structure",
  "doc-errata": "structure",
  "doc-example": "structure",
  "doc-footnote": "structure",
  "doc-foreword": "structure",
  "doc-glossary": "structure",
  "doc-glossref": "widget",
  "doc-index": "structure",
  "doc-introduction": "structure",
  "doc-noteref": "widget",
  "doc-notice": "structure",
  "doc-pagebreak": "structure",
  "doc-pagelist": "structure",
  "doc-part": "structure",
  "doc-preface": "structure",
  "doc-prologue": "structure",
  "doc-pullquote": "structure",
  "doc-qna": "structure",
  "doc-subtitle": "structure",
  "doc-tip": "structure",
  "doc-toc": "structure",
  "graphics-document": "structure",
  "graphics-object": "structure",
  "graphics-symbol": "structure",
  "doc-pageheader": "structure",
  "doc-pagefooter": "structure",
  alert: "structure",
  alertdialog: "structure",
  application: "structure",
  article: "structure",
  banner: "structure",
  blockquote: "structure",
  button: "widget",
  caption: "structure",
  cell: "structure",
  checkbox: "widget",
  code: "structure",
  comment: "structure",
  columnheader: "grid-header",
  combobox: "choice-input",
  complementary: "structure",
  contentinfo: "structure",
  definition: "structure",
  deletion: "structure",
  dialog: "structure",
  directory: "structure",
  document: "structure",
  emphasis: "structure",
  feed: "structure",
  figure: "structure",
  form: "structure",
  generic: "structure",
  grid: "widget",
  gridcell: "widget",
  group: "structure",
  heading: "structure",
  img: "structure",
  insertion: "structure",
  link: "widget",
  list: "structure",
  listbox: "choice-list",
  listitem: "structure",
  log: "structure",
  main: "structure",
  marquee: "structure",
  mark: "structure",
  math: "structure",
  menu: "widget",
  menubar: "widget",
  menuitem: "widget",
  menuitemcheckbox: "widget",
  menuitemradio: "widget",
  meter: "structure",
  navigation: "structure",
  none: "structure",
  note: "structure",
  option: "widget",
  paragraph: "structure",
  presentation: "structure",
  progressbar: "widget",
  radio: "widget",
  radiogroup: "choice-radio",
  region: "structure",
  row: "structure",
  rowgroup: "structure",
  rowheader: "grid-header",
  scrollbar: "widget",
  search: "structure",
  sectionheader: "structure",
  sectionfooter: "structure",
  image: "structure",
  searchbox: "widget",
  separator: "structure",
  slider: "widget",
  spinbutton: "widget",
  status: "structure",
  strong: "structure",
  suggestion: "structure",
  subscript: "structure",
  superscript: "structure",
  switch: "widget",
  tab: "widget",
  table: "structure",
  tablist: "widget",
  tabpanel: "widget",
  term: "structure",
  textbox: "widget",
  time: "structure",
  timer: "structure",
  toolbar: "structure",
  tooltip: "structure",
  tree: "widget",
  treegrid: "widget",
  treeitem: "widget",
};
function shellRole(element: Element): string | undefined {
  return (element.getAttribute("role") ?? "")
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase())
    .split(/[ \t\n\f\r]+/)
    .find((token) => Object.hasOwn(SHELL_ROLES, token));
}
function sameShellOwner(a: Element, b: Element): boolean {
  const left = a.closest("[data-rid][data-part]");
  const right = b.closest("[data-rid][data-part]");
  return (
    left !== null &&
    right !== null &&
    left.getAttribute("data-rid") === right.getAttribute("data-rid") &&
    left.getAttribute("data-rid-key") === right.getAttribute("data-rid-key")
  );
}
function shellChoiceInputPart(element: Element): "input" | "list" | undefined {
  const role = shellRole(element);
  if (role === "listbox") return "list";
  const textInput =
    element.matches("input") &&
    ["", "text", "search", "email", "tel", "url", "password"].includes(
      (element.getAttribute("type") ?? "").toLowerCase(),
    );
  return role === "textbox" || role === "searchbox" || textInput
    ? "input"
    : undefined;
}
function isShellSnapshotControl(
  element: Element,
  visible: (element: Element) => boolean,
): boolean {
  if (element.parentElement?.closest("select")) return false;
  const role = shellRole(element);
  for (
    let parent = element.parentElement;
    parent && sameShellOwner(element, parent);
    parent = parent.parentElement
  ) {
    const parentRole = shellRole(parent);
    const kind = parentRole === undefined ? undefined : SHELL_ROLES[parentRole];
    if (
      (kind === "choice-list" && role === "option") ||
      (kind === "choice-radio" &&
        (role === "radio" || element.matches('input[type="radio"]')))
    )
      return false;
    const part = shellChoiceInputPart(element);
    if (kind === "choice-input" && part !== undefined) {
      const peers = [...parent.querySelectorAll("*")].filter(
        (candidate) =>
          visible(candidate) &&
          sameShellOwner(element, candidate) &&
          shellChoiceInputPart(candidate) === part,
      );
      if (peers.length === 1) return false;
    }
  }
  const editable = element.getAttribute("contenteditable");
  if (
    (editable !== null &&
      ["", "true", "plaintext-only"].includes(editable.toLowerCase())) ||
    element.matches(
      "button,summary,a[href],area[href],input:not([type=hidden]),select,textarea,audio[controls],video[controls],[tabindex]",
    )
  )
    return true;
  if (role === undefined) return false;
  if (SHELL_ROLES[role] === "grid-header") {
    for (
      let parent = element.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      const context = shellRole(parent);
      if (context === "grid" || context === "treegrid") return true;
      if (context === "table" || parent.matches("table")) return false;
    }
    return false;
  }
  return SHELL_ROLES[role] !== "structure";
}

/** Group wrapper/control tags; reject separate visible copies instead of merging them. */
export function captureShellSnapshot(
  root: ParentNode,
  options: {
    visible: (element: Element) => boolean;
    observe: (
      identity: ShellSnapshotIdentity,
      elements: readonly Element[],
      order: number,
    ) => ShellSemanticSnapshot;
  },
): ShellSemanticSnapshot[] {
  const groups = new Map<
    string,
    { identity: ShellSnapshotIdentity; elements: Element[] }
  >();
  for (const element of root.querySelectorAll("[data-rid][data-part]")) {
    if (!options.visible(element)) continue;
    const content = element.closest("[data-shell-content-id]");
    const menu = element.closest("[data-shell-menu-owner]");
    if (content && (!menu || !content.contains(menu))) continue;
    const identity = {
      id: element.getAttribute("data-rid") ?? "",
      ...(element.hasAttribute("data-rid-key")
        ? { entityKey: element.getAttribute("data-rid-key") ?? "" }
        : {}),
    };
    if (!identity.id) throw new Error("Empty row identity");
    const key = identityKey(identity);
    const group = groups.get(key);
    if (group) {
      if (
        !group.elements.some(
          (other) => other.contains(element) || element.contains(other),
        )
      )
        throw new Error(`Duplicate visible identity: ${key}`);
      group.elements.push(element);
    } else groups.set(key, { identity, elements: [element] });
  }
  for (const [key, group] of groups) {
    let controls = 0;
    const element = group.elements.at(0);
    if (element === undefined)
      throw new Error(`Identity has no elements: ${key}`);
    for (const candidate of [element, ...element.querySelectorAll("*")]) {
      if (
        !options.visible(candidate) ||
        !isShellSnapshotControl(candidate, options.visible)
      )
        continue;
      const owner = candidate.closest("[data-rid][data-part]");
      if (
        owner &&
        owner.getAttribute("data-rid") === group.identity.id &&
        (owner.hasAttribute("data-rid-key")
          ? owner.getAttribute("data-rid-key")
          : undefined) === group.identity.entityKey
      )
        controls++;
    }
    if (controls > 1) throw new Error(`Duplicate visible identity: ${key}`);
  }
  const snapshots = [...groups.values()].map((group, order) => {
    const snapshot = options.observe(group.identity, group.elements, order);
    if (identityKey(snapshot) !== identityKey(group.identity))
      throw new Error("Observer changed row identity");
    return snapshot;
  });
  unique(snapshots);
  return snapshots;
}
export interface ShellCoverageRow {
  id: string;
  counted: boolean;
  forecast: "supported" | "custom";
  contractEntry: string | null;
  reason?: string;
  members: readonly string[];
  presentations: readonly string[];
}
export interface ShellMountWitness {
  id: string;
  member: string | null;
  presentation: string;
  mounted: boolean;
  sharedBody: boolean;
}
export function shellCoverage(
  rows: readonly ShellCoverageRow[],
  witnesses: readonly ShellMountWitness[],
) {
  if (new Set(rows.map((row) => row.id)).size !== rows.length)
    throw new Error("Duplicate coverage row");
  for (const witness of witnesses)
    if (!rows.some((row) => row.id === witness.id))
      throw new Error(`Unknown witness row: ${witness.id}`);
  const entries = rows
    .filter((row) => row.counted)
    .map((row) => {
      if (row.forecast === "custom" && row.contractEntry !== null)
        throw new Error(`Custom row cannot claim a contract: ${row.id}`);
      if (row.forecast === "supported" && !row.contractEntry)
        throw new Error(`Missing contract entry: ${row.id}`);
      if (row.forecast === "custom" && !row.reason?.trim())
        throw new Error(`Missing custom reason: ${row.id}`);
      const members: readonly (string | null)[] = row.members.length
        ? row.members
        : [null];
      const missing: string[] = [];
      let strict = true;
      if (!row.presentations.length)
        missing.push("no presentation requirement");
      for (const member of members)
        for (const presentation of row.presentations) {
          const matches = witnesses.filter(
            (witness) =>
              witness.id === row.id &&
              witness.member === member &&
              witness.presentation === presentation &&
              witness.mounted,
          );
          if (!matches.length)
            missing.push(JSON.stringify([member, presentation]));
          if (
            !matches.length ||
            !matches.every((witness) => witness.sharedBody)
          )
            strict = false;
        }
      const covered = row.forecast === "supported" && missing.length === 0;
      return {
        id: row.id,
        contractEntry: row.contractEntry,
        covered,
        strict: covered && strict,
        missing,
        reason: row.reason,
      };
    });
  return {
    denominator: entries.length,
    expressible: entries.filter((row) => row.contractEntry !== null).length,
    covered: entries.filter((row) => row.covered).length,
    strict: entries.filter((row) => row.strict).length,
    entries,
  };
}

export interface ShellContentSlotSnapshot extends ShellSnapshotIdentity {
  key: string;
  owner: "custom" | "later-pattern";
  reason: string;
  order: number;
  placement?: {
    frame: number;
    index: number;
    before: ShellSnapshotIdentity | null;
    after: ShellSnapshotIdentity | null;
  };
}
function shellContentPlacement(root: ParentNode, element: Element) {
  const frameSelector = '[data-part="sidebar"],nav';
  const frame = element.closest(frameSelector);
  if (!frame) throw new Error("Shell content slot has no sidebar frame");
  const frames = [
    ...(root instanceof Element && root.matches(frameSelector) ? [root] : []),
    ...root.querySelectorAll(frameSelector),
  ];
  const frameIndex = frames.indexOf(frame);
  if (frameIndex < 0)
    throw new Error("Shell content frame is outside capture root");
  const boundaries = [
    ...frame.querySelectorAll("[data-rid][data-part],[data-shell-content-id]"),
  ].filter((node) => {
    if (node.closest(frameSelector) !== frame) return false;
    const content = node.closest("[data-shell-content-id]");
    if (content && content !== node) return false;
    const parentRow = node.parentElement?.closest("[data-rid][data-part]");
    return !parentRow || !frame.contains(parentRow);
  });
  const index = boundaries.indexOf(element);
  if (index < 0)
    throw new Error("Shell content slot is nested in a modeled row");
  const identity = (node: Element | undefined): ShellSnapshotIdentity | null =>
    node
      ? {
          id: node.getAttribute("data-rid") ?? "",
          ...(node.hasAttribute("data-rid-key")
            ? { entityKey: node.getAttribute("data-rid-key") ?? "" }
            : {}),
        }
      : null;
  const modeled = (nodes: Element[]) =>
    nodes.filter((node) => node.hasAttribute("data-rid"));
  return {
    frame: frameIndex,
    index,
    before: identity(modeled(boundaries.slice(0, index)).at(-1)),
    after: identity(modeled(boundaries.slice(index + 1))[0]),
  };
}
export function captureShellContentSlots(
  root: ParentNode,
): ShellContentSlotSnapshot[] {
  return [...root.querySelectorAll("[data-shell-content-id]")].map(
    (element) => {
      const slot = element.querySelector("[data-shell-slot]");
      const owner = slot?.getAttribute("data-shell-owner");
      const reason = slot?.getAttribute("data-shell-reason");
      const key = slot?.getAttribute("data-shell-slot");
      const id = element.getAttribute("data-shell-content-id");
      const rawOrder = element.getAttribute("data-shell-content-order");
      if (
        (owner !== "custom" && owner !== "later-pattern") ||
        !reason?.trim() ||
        !key ||
        !id ||
        rawOrder === null ||
        !Number.isFinite(Number(rawOrder))
      )
        throw new Error("Invalid shell content ownership");
      return {
        id,
        ...(element.hasAttribute("data-shell-content-key")
          ? { entityKey: element.getAttribute("data-shell-content-key") ?? "" }
          : {}),
        key,
        owner,
        reason,
        order: Number(rawOrder),
        placement: shellContentPlacement(root, element),
      };
    },
  );
}
export function compareShellContentSlots(
  source: readonly ShellContentSlotSnapshot[],
  house: readonly ShellContentSlotSnapshot[],
) {
  const left = unique(source),
    right = unique(house);
  const differences: string[] = [];
  if (!equal([...left.keys()], [...right.keys()]))
    differences.push("content slot order");
  for (const key of new Set([...left.keys(), ...right.keys()]))
    if (!equal(left.get(key), right.get(key)))
      differences.push(`${key}: content ownership`);
  return differences;
}

/** Observe symbols from DOM, independently of the model and registry. */
export function captureShellSymbols(
  root: ParentNode,
): readonly { key: string; fallback: boolean }[] {
  return Array.from(root.querySelectorAll("[data-shell-symbol]")).map(
    (element) => ({
      key: element.getAttribute("data-shell-symbol") ?? "",
      fallback: element.hasAttribute("data-shell-symbol-fallback"),
    }),
  );
}
