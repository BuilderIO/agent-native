/** Dotted, lowercase, at least two segments: `sidebar.nav.inbox`. */
export type RowId = string;

/** A model part, or a part and sub-part: `settings`, `settings.row`. */
export type PartRef = string;

export type RowKind =
  | "section"
  | "destination"
  | "action"
  | "toggle"
  | "choice"
  | "field"
  | "info";

export type RowIcon =
  | { kind: "symbol"; key: string }
  | { kind: "image"; src: string; alt?: string | undefined };

export type RowBadge =
  | { kind: "count"; value: number }
  | { kind: "dot" }
  | {
      kind: "label";
      value: string;
      /** It asks for the person's attention (a required setup step). */
      tone?: "attention" | undefined;
    };

export interface RowState {
  /** The current destination or the chosen option. */
  selected?: boolean | undefined;
  checked?: boolean | "mixed" | undefined;
  expanded?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Work for this row is in flight. */
  pending?: boolean | undefined;
  /** What the row sets up is done: connected, configured. */
  complete?: boolean | undefined;
  /** A field's or choice's current value, as text. */
  value?: string | undefined;
  badge?: RowBadge | undefined;
}

export type RowEffect =
  | { kind: "navigate"; to: string }
  | { kind: "action"; effectId: string }
  | { kind: "open"; target: RowId };

export interface ModelRow {
  id: RowId;
  part: PartRef;
  /** The row's accessible name. Both part sets must expose exactly this text. */
  label: string;
  kind?: RowKind | undefined;
  description?: string | undefined;
  icon?: RowIcon | undefined;
  state?: RowState | undefined;
  effect?: RowEffect | undefined;
  /** Nested rows: a section's entries, a menu's items. */
  rows?: readonly ModelRow[] | undefined;
  /**
   * Content that belongs to one app (a canvas, a custom control), drawn
   * by the app beside the parts. The key names it for both part sets.
   */
  slot?: string | undefined;
  /**
   * App content for the part's other named regions, by region (a settings
   * row's `status` beside its label, or its `detail` below it). Each value is
   * a slot key the app fills, as with `slot`. A part throws on a region it
   * does not draw.
   */
  regions?: Readonly<Record<string, string>> | undefined;
  /**
   * The label names the row for assistive technology only: a group with no
   * visible title still has a name, drawn visually hidden.
   */
  labelHidden?: boolean | undefined;
  /**
   * Rows drawn inside this row's slot or regions by their own surfaces, by id: a section
   * whose component mounts only when shown and owns its rows' state. `"any"`
   * when the slot holds content the app passed in, whose rows it cannot
   * know. A surface nested in a slot that does not host its rows throws.
   */
  hosts?: readonly RowId[] | "any" | undefined;
  /**
   * The DOM id the row's element carries, for deep links and search results
   * that scroll to it (`#bell-sound`). Unique on the page.
   */
  anchor?: string | undefined;
}

export interface ScreenModel {
  /** The surface's own id, the first segment its rows usually share. */
  id: string;
  rows: readonly ModelRow[];
}
