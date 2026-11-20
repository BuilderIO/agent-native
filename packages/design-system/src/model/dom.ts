import type { ModelRow, RowBadge, RowEffect } from "./types.js";

/**
 * The attributes every part writes on the element that draws a row, in every
 * part set. State is not here: it is read from the element's ARIA and native
 * state (aria-current, aria-selected, aria-checked, aria-expanded, disabled,
 * aria-busy), so two part sets that agree on state also agree on what
 * assistive technology hears. The one exception is `complete`, which ARIA
 * has no state for.
 */
export interface RowAttributes {
  "data-row-id": string;
  "data-part": string;
  "data-row-kind"?: string;
  "data-row-effect"?: string;
  "data-row-badge"?: string;
  "data-row-slot"?: string;
  "data-row-regions"?: string;
  "data-row-hosts"?: string;
  "data-row-complete"?: "true";
  id?: string;
}

export function encodeEffect(effect: RowEffect): string {
  switch (effect.kind) {
    case "navigate":
      return `navigate:${effect.to}`;
    case "action":
      return `action:${effect.effectId}`;
    case "open":
      return `open:${effect.target}`;
  }
}

export function encodeBadge(badge: RowBadge): string {
  switch (badge.kind) {
    case "count":
      return `count:${badge.value}`;
    case "dot":
      return "dot";
    case "label":
      return badge.tone
        ? `label-${badge.tone}:${badge.value}`
        : `label:${badge.value}`;
  }
}

/** `region:slot` pairs in region order, so both part sets write the same text. */
export function encodeRegions(
  regions: Readonly<Record<string, string>>,
): string {
  return Object.entries(regions)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([region, slot]) => `${region}:${slot}`)
    .join(" ");
}

export function rowAttributes(row: ModelRow): RowAttributes {
  const attributes: RowAttributes = {
    "data-row-id": row.id,
    "data-part": row.part,
  };
  if (row.kind) attributes["data-row-kind"] = row.kind;
  if (row.effect) attributes["data-row-effect"] = encodeEffect(row.effect);
  if (row.state?.badge) {
    attributes["data-row-badge"] = encodeBadge(row.state.badge);
  }
  if (row.slot) attributes["data-row-slot"] = row.slot;
  if (row.hosts === "any") {
    attributes["data-row-hosts"] = "any";
  } else if (row.hosts && row.hosts.length > 0) {
    attributes["data-row-hosts"] = row.hosts.join(" ");
  }
  if (row.state?.complete) attributes["data-row-complete"] = "true";
  if (row.regions && Object.keys(row.regions).length > 0) {
    attributes["data-row-regions"] = encodeRegions(row.regions);
  }
  if (row.anchor) attributes.id = row.anchor;
  return attributes;
}

/** What a rendered row exposes, independent of how it is drawn. */
export interface RowSnapshot {
  id: string;
  part: string;
  parentId: string | null;
  /** Position among its siblings under the same parent row. */
  position: number;
  kind: string | null;
  name: string;
  selected: boolean;
  checked: "true" | "false" | "mixed" | null;
  expanded: boolean | null;
  disabled: boolean;
  pending: boolean;
  value: string | null;
  effect: string | null;
  badge: string | null;
  slot: string | null;
  regions: string | null;
  hosts: string | null;
  complete: boolean;
}

const ROW_SELECTOR = "[data-row-id]";
const CONTROL_SELECTOR =
  "input,select,textarea,button,[role=switch],[role=checkbox],[role=radio],[role=option],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=tab],[role=treeitem],a[href]";

/** The element's own text, leaving out any nested rows. */
function ownText(element: Element): string {
  let text = "";
  for (const node of element.childNodes) {
    if (node.nodeType === 3) {
      text += node.textContent ?? "";
    } else if (node.nodeType === 1) {
      const child = node as Element;
      if (child.matches(ROW_SELECTOR)) continue;
      if (child.getAttribute("aria-hidden") === "true") continue;
      text += ` ${ownText(child)} `;
    }
  }
  return text;
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function labelledByText(element: Element): string | null {
  const ids = element.getAttribute("aria-labelledby");
  if (!ids) return null;
  const document = element.ownerDocument;
  const text = ids
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
  return normalizeSpace(text) || null;
}

/** The row's control: the row element itself, or its first own control. */
function rowControl(row: Element): Element {
  if (row.matches(CONTROL_SELECTOR)) return row;
  for (const candidate of row.querySelectorAll(CONTROL_SELECTOR)) {
    if (candidate.closest(ROW_SELECTOR) === row) return candidate;
  }
  return row;
}

/**
 * The accessible name, in the order assistive technology resolves the common
 * cases: aria-label, aria-labelledby, an explicit `[data-row-label]`, then
 * the row's own text.
 */
export function rowName(row: Element): string {
  const control = rowControl(row);
  for (const element of control === row ? [row] : [row, control]) {
    const label = element.getAttribute("aria-label");
    if (label && normalizeSpace(label)) return normalizeSpace(label);
    const labelledBy = labelledByText(element);
    if (labelledBy) return labelledBy;
  }
  const explicit = row.querySelector("[data-row-label]");
  if (explicit && explicit.closest(ROW_SELECTOR) === row) {
    return normalizeSpace(explicit.textContent);
  }
  return normalizeSpace(ownText(row));
}

function booleanAttribute(element: Element, name: string): boolean | null {
  const value = element.getAttribute(name);
  if (value === null) return null;
  return value !== "false";
}

function snapshotRow(row: Element, position: number): RowSnapshot {
  const control = rowControl(row);
  const both = control === row ? [row] : [row, control];
  const first = (read: (element: Element) => string | null) =>
    both.map(read).find((value) => value !== null) ?? null;

  const current = first((element) => element.getAttribute("aria-current"));
  const selected =
    (current !== null && current !== "false") ||
    first((element) => element.getAttribute("aria-selected")) === "true";

  const nativeChecked =
    control instanceof HTMLInputElement &&
    (control.type === "checkbox" || control.type === "radio")
      ? control.indeterminate
        ? "mixed"
        : String(control.checked)
      : null;
  const ariaChecked = first((element) => element.getAttribute("aria-checked"));
  const checked = (nativeChecked ?? ariaChecked) as RowSnapshot["checked"];

  const expanded = both
    .map((element) => booleanAttribute(element, "aria-expanded"))
    .find((value) => value !== null);

  const disabled = both.some(
    (element) =>
      element.hasAttribute("disabled") ||
      element.getAttribute("aria-disabled") === "true",
  );

  const value =
    control instanceof HTMLInputElement &&
    control.type !== "checkbox" &&
    control.type !== "radio"
      ? control.value
      : control instanceof HTMLSelectElement ||
          control instanceof HTMLTextAreaElement
        ? control.value
        : first((element) => element.getAttribute("aria-valuetext"));

  const parent = row.parentElement?.closest(ROW_SELECTOR) ?? null;
  return {
    id: row.getAttribute("data-row-id") ?? "",
    part: row.getAttribute("data-part") ?? "",
    parentId: parent?.getAttribute("data-row-id") ?? null,
    position,
    kind: row.getAttribute("data-row-kind"),
    name: rowName(row),
    selected,
    checked: checked === null ? null : checked,
    expanded: expanded ?? null,
    disabled,
    pending: both.some(
      (element) => element.getAttribute("aria-busy") === "true",
    ),
    value,
    effect: row.getAttribute("data-row-effect"),
    badge: row.getAttribute("data-row-badge"),
    slot: row.getAttribute("data-row-slot"),
    regions: row.getAttribute("data-row-regions"),
    hosts: row.getAttribute("data-row-hosts"),
    complete: row.getAttribute("data-row-complete") === "true",
  };
}

/**
 * Every rendered row under `root`, in document order. Rows rendered into a
 * portal are included when the portal is inside `root` (pass `document`).
 */
export function captureRows(root: ParentNode): RowSnapshot[] {
  const positions = new Map<string | null, number>();
  return [...root.querySelectorAll(ROW_SELECTOR)].map((row) => {
    const parentId =
      row.parentElement?.closest(ROW_SELECTOR)?.getAttribute("data-row-id") ??
      null;
    const position = positions.get(parentId) ?? 0;
    positions.set(parentId, position + 1);
    return snapshotRow(row, position);
  });
}
