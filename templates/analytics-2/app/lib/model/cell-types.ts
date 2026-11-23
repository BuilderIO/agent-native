/**
 * The cell kinds a project can hold, the menu that creates them, and the
 * default heights each one renders at.
 *
 * The add-cell menu is built from this table: categories appear in
 * `CELL_CATEGORY_ORDER`, and each category lists its kinds by
 * `orderInCategory`. Kinds with `creatable: false` never appear there.
 */

export const CELL_KINDS = [
  "code",
  "sql",
  "writeback",
  "pivot",
  "filter",
  "dbt-metric",
  "component-import",
  "collapsible",
  "text",
  "markdown",
  "display-table",
  "vega-chart",
  "chart",
  "explore",
  "metric",
  "map",
  "input",
  "cell-group",
  "block",
] as const;

export type CellKind = (typeof CELL_KINDS)[number];

export const CELL_CATEGORIES = [
  "logic",
  "text",
  "data",
  "transform",
  "visualization",
  "input",
] as const;

export type CellCategory = (typeof CELL_CATEGORIES)[number];

export type CellCategoryDefinition = {
  /** Shown above a group of kinds in the add-cell menu. */
  title: string;
  /** Second line of that group. */
  description: string;
};

/**
 * Categories with a group header. `logic` has none: its kinds are listed on
 * their own in the add-cell menu.
 */
export const CELL_CATEGORY_DEFINITIONS: Partial<
  Record<CellCategory, CellCategoryDefinition>
> = {
  text: {
    title: "Text cells",
    description: "Rich and dynamic text content.",
  },
  visualization: {
    title: "Visualization cells",
    description: "Easy to configure data visualizations.",
  },
  input: {
    title: "Inputs",
    description: "Interactive parameters enabling dynamic inputs.",
  },
  data: {
    title: "Data cells",
    description: "Pull in data and writeback to a warehouse.",
  },
  transform: {
    title: "Transform cells",
    description: "Transform data without code for downstream usage.",
  },
};

/** The order the add-cell menu lists categories in. */
export const CELL_CATEGORY_ORDER: readonly CellCategory[] = [
  "logic",
  "text",
  "data",
  "transform",
  "visualization",
  "input",
];

export type CellKindDefinition = {
  kind: CellKind;
  /** Name shown in the add-cell menu and the cell type menu. */
  name: string;
  category: CellCategory;
  orderInCategory: number;
  /** Key the add-cell menu offers for this kind. */
  shortcut?: string;
  /** Whether a new project can create this kind from its menus. */
  creatable: boolean;
  /** Whether the kind is offered at all, including from menus that list disabled types. */
  offered: boolean;
  /** Noun used in the default cell label ("SQL 3", "Map 2"). */
  labelNoun: string;
  /** Height in pixels a cell of this kind starts at, or null when it is auto. */
  defaultHeight: number | null;
  /** Whether this kind can be a project's very first cell. */
  takesFirstSlot: boolean;
};

const KIND_DEFINITIONS: Record<CellKind, CellKindDefinition> = {
  code: {
    kind: "code",
    name: "Python",
    category: "logic",
    orderInCategory: 1,
    shortcut: "w",
    creatable: true,
    offered: true,
    labelNoun: "Code",
    defaultHeight: 450,
    takesFirstSlot: true,
  },
  sql: {
    kind: "sql",
    name: "SQL",
    category: "logic",
    orderInCategory: 2,
    shortcut: "q",
    creatable: true,
    offered: true,
    labelNoun: "SQL",
    defaultHeight: 450,
    takesFirstSlot: true,
  },
  writeback: {
    kind: "writeback",
    name: "Writeback",
    category: "data",
    orderInCategory: 2,
    creatable: false,
    offered: false,
    labelNoun: "Writeback",
    defaultHeight: 200,
    takesFirstSlot: false,
  },
  pivot: {
    kind: "pivot",
    name: "Pivot",
    category: "transform",
    orderInCategory: 1,
    shortcut: "v",
    creatable: true,
    offered: true,
    labelNoun: "Pivot",
    defaultHeight: 450,
    takesFirstSlot: false,
  },
  filter: {
    kind: "filter",
    name: "Filter",
    category: "transform",
    orderInCategory: 2,
    creatable: true,
    offered: true,
    labelNoun: "Filter",
    defaultHeight: 450,
    takesFirstSlot: false,
  },
  "dbt-metric": {
    kind: "dbt-metric",
    name: "Metric",
    category: "data",
    orderInCategory: 1,
    creatable: true,
    offered: true,
    labelNoun: "Metric",
    defaultHeight: 450,
    takesFirstSlot: false,
  },
  "component-import": {
    kind: "component-import",
    name: "Component",
    category: "logic",
    orderInCategory: 2,
    creatable: true,
    offered: true,
    labelNoun: "Component",
    defaultHeight: 200,
    takesFirstSlot: false,
  },
  collapsible: {
    kind: "collapsible",
    name: "Section",
    category: "logic",
    orderInCategory: 2,
    creatable: true,
    offered: true,
    labelNoun: "Section",
    defaultHeight: 200,
    takesFirstSlot: false,
  },
  text: {
    kind: "text",
    name: "Text",
    category: "text",
    orderInCategory: 1,
    shortcut: "e",
    creatable: true,
    offered: true,
    labelNoun: "Text",
    defaultHeight: 200,
    takesFirstSlot: true,
  },
  markdown: {
    kind: "markdown",
    name: "Markdown",
    category: "text",
    orderInCategory: 2,
    shortcut: "n",
    creatable: true,
    offered: true,
    labelNoun: "Markdown",
    defaultHeight: 200,
    takesFirstSlot: true,
  },
  "display-table": {
    kind: "display-table",
    name: "Table",
    category: "visualization",
    orderInCategory: 2,
    shortcut: "t",
    creatable: true,
    offered: true,
    labelNoun: "Table",
    defaultHeight: 450,
    takesFirstSlot: false,
  },
  "vega-chart": {
    kind: "vega-chart",
    name: "Vega chart",
    category: "visualization",
    orderInCategory: 1,
    creatable: false,
    offered: false,
    labelNoun: "Chart",
    defaultHeight: 540,
    takesFirstSlot: false,
  },
  chart: {
    kind: "chart",
    name: "Chart",
    category: "visualization",
    orderInCategory: 0,
    shortcut: "r",
    creatable: true,
    offered: true,
    labelNoun: "Chart",
    defaultHeight: 540,
    takesFirstSlot: false,
  },
  explore: {
    kind: "explore",
    name: "Explore",
    category: "visualization",
    orderInCategory: 5,
    creatable: false,
    offered: false,
    labelNoun: "Chart",
    defaultHeight: 650,
    takesFirstSlot: false,
  },
  metric: {
    kind: "metric",
    name: "Single value",
    category: "visualization",
    orderInCategory: 4,
    shortcut: "u",
    creatable: true,
    offered: true,
    labelNoun: "Value",
    defaultHeight: 123,
    takesFirstSlot: false,
  },
  map: {
    kind: "map",
    name: "Map",
    category: "visualization",
    orderInCategory: 3,
    creatable: true,
    offered: true,
    labelNoun: "Map",
    defaultHeight: null,
    takesFirstSlot: false,
  },
  input: {
    kind: "input",
    name: "Input",
    category: "input",
    orderInCategory: 0,
    creatable: true,
    offered: true,
    labelNoun: "Cell",
    defaultHeight: 200,
    takesFirstSlot: false,
  },
  // Deprecated. Kept so older projects still load.
  "cell-group": {
    kind: "cell-group",
    name: "Group",
    category: "logic",
    orderInCategory: 9,
    creatable: false,
    offered: false,
    labelNoun: "Cell",
    defaultHeight: null,
    takesFirstSlot: false,
  },
  // Containers created by the layout, never by hand.
  block: {
    kind: "block",
    name: "Block",
    category: "logic",
    orderInCategory: 9,
    creatable: false,
    offered: false,
    labelNoun: "Block",
    defaultHeight: 450,
    takesFirstSlot: false,
  },
};

export function cellKindDefinition(kind: CellKind): CellKindDefinition {
  return KIND_DEFINITIONS[kind];
}

export function isCellKind(value: string): value is CellKind {
  return (CELL_KINDS as readonly string[]).includes(value);
}

export type CellMenuEntry = {
  kind: CellKind;
  /** Name shown for this entry in the add-cell menu. */
  name: string;
  category: CellCategory;
  orderInCategory: number;
  shortcut?: string;
  /** Set on the parameter entries, which all share the `input` kind. */
  inputType?: ParameterInputType;
};

/**
 * The add-cell menu, in the order it lists entries: by category, then by the
 * category's own order. The Inputs category expands to one entry per
 * parameter type.
 */
/**
 * The kinds the More menu may show: the ones the project editor can add, which
 * in turn must all be accepted by the add-cell action. Kept next to the menu
 * vocabulary so the two cannot drift apart unnoticed.
 */
/**
 * The kinds add-project-cell can create. The action's schema, the notebook page's
 * guard and the add-cell menu all read this one list: when they were three copies,
 * the menu silently dropped Component even though the action accepted it.
 */
export const ADDABLE_CELL_KINDS = [
  "sql",
  "code",
  "markdown",
  "text",
  "input",
  "chart",
  "pivot",
  "metric",
  "dbt-metric",
  "display-table",
  "component-import",
  "collapsible",
] as const satisfies readonly CellKind[];

export type AddableCellKind = (typeof ADDABLE_CELL_KINDS)[number];

const MENU_ONLY_ADDABLE_KINDS: readonly CellKind[] = ADDABLE_CELL_KINDS.filter(
  (kind) => kind !== "sql" && kind !== "code",
);

export function creatableMenuKinds(
  supportedAddKinds: readonly CellKind[] = [],
): ReadonlySet<CellKind> {
  return new Set<CellKind>([
    ...supportedAddKinds.filter((kind) =>
      (ADDABLE_CELL_KINDS as readonly CellKind[]).includes(kind),
    ),
    ...MENU_ONLY_ADDABLE_KINDS,
  ]);
}

export function addCellMenuEntries(): CellMenuEntry[] {
  const entries: CellMenuEntry[] = [];
  for (const category of CELL_CATEGORY_ORDER) {
    if (category === "input") {
      parameterInputMenuOrder().forEach((inputType, index) => {
        entries.push({
          kind: "input",
          name: parameterInputName(inputType),
          category,
          orderInCategory: index,
          inputType,
        });
      });
      continue;
    }
    const inCategory = CELL_KINDS.map(cellKindDefinition)
      .filter(
        (definition) =>
          definition.category === category && definition.creatable,
      )
      .sort((a, b) => a.orderInCategory - b.orderInCategory);
    for (const definition of inCategory) {
      entries.push({
        kind: definition.kind,
        name: definition.name,
        category: definition.category,
        orderInCategory: definition.orderInCategory,
        ...(definition.shortcut === undefined
          ? {}
          : { shortcut: definition.shortcut }),
      });
    }
  }
  return entries;
}

/** The kinds the add-cell menu offers, without duplicates. */
export function addCellMenuKinds(): CellKind[] {
  return [...new Set(addCellMenuEntries().map((entry) => entry.kind))];
}

/** The kind each add-cell shortcut creates. */
export function shortcutToCellKind(): Record<string, CellKind> {
  const shortcuts: Record<string, CellKind> = {};
  for (const kind of CELL_KINDS) {
    const definition = KIND_DEFINITIONS[kind];
    if (definition.creatable && definition.shortcut) {
      shortcuts[definition.shortcut] = kind;
    }
  }
  return shortcuts;
}

export const PARAMETER_INPUT_TYPES = [
  "DATE",
  "DROPDOWN",
  "BUTTON",
  "CHECKBOX",
  "NUMERIC_INPUT",
  "SLIDER",
  "TEXT_INPUT",
  "TABLE",
  "MULTISELECT",
  "FILE_UPLOAD",
] as const;

export type ParameterInputType = (typeof PARAMETER_INPUT_TYPES)[number];

/**
 * Input definitions carry a lower-case label in most cases; the menu shows it
 * upper-cased on the first letter.
 */
const PARAMETER_INPUT_LABELS: Record<ParameterInputType, string> = {
  DATE: "date",
  DROPDOWN: "dropdown",
  BUTTON: "Button",
  CHECKBOX: "Checkbox",
  NUMERIC_INPUT: "number input",
  SLIDER: "slider",
  TEXT_INPUT: "text input",
  TABLE: "table input",
  MULTISELECT: "multiselect",
  FILE_UPLOAD: "File upload",
};

function capitalizeLabel(label: string): string {
  if (label.length === 0) return label;
  return label[0]!.toUpperCase() + label.slice(1);
}

/** The name each input type shows in the add-cell menu. */
export function parameterInputName(type: ParameterInputType): string {
  return capitalizeLabel(PARAMETER_INPUT_LABELS[type]);
}

/** Input types in menu order: by their underlying label. */
export function parameterInputMenuOrder(): ParameterInputType[] {
  return [...PARAMETER_INPUT_TYPES].sort((a, b) =>
    PARAMETER_INPUT_LABELS[a].localeCompare(PARAMETER_INPUT_LABELS[b]),
  );
}

export function isParameterInputType(
  value: string,
): value is ParameterInputType {
  return (PARAMETER_INPUT_TYPES as readonly string[]).includes(value);
}
