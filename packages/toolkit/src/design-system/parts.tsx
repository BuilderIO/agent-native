import {
  assertValidModel,
  type ModelRow,
  rowAttributes,
  type ScreenModel,
} from "@agent-native/design-system/model";
import {
  type ComponentType,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
} from "react";

import { agentNativeParts } from "./agent-native-parts/index.js";
import { useDesignSystem } from "./context.js";
import type { DesignSystemDefinition } from "./definition.js";
import {
  useWholePart,
  type WholePartName,
  type WholeParts,
} from "./whole-parts.js";

export { useWholePart, type WholePartName, type WholeParts };

/**
 * A part draws one model row. It spreads `rowAttributes(row)` on the element
 * that represents the row, exposes the row's state through ARIA or native
 * state, and renders `children` (the row's nested rows) where they belong.
 */
export interface PartProps {
  row: ModelRow;
  children?: ReactNode;
}

export type PartComponent = ComponentType<PartProps>;

/**
 * Markup for model parts, keyed by part reference (`settings.row`). A part
 * set draws every part its screens use; one that reuses toolkit's parts
 * spreads `AGENT_NATIVE_PART_SET.parts` into its own. `whole` holds the
 * surfaces it draws whole from their typed models (`settings`).
 */
export interface PartSet {
  name: string;
  parts: Readonly<Partial<Record<string, PartComponent>>>;
  whole?: Readonly<Partial<WholeParts>> | undefined;
}

export function definePartSet<const Set extends PartSet>(partSet: Set): Set {
  return partSet;
}

/**
 * Toolkit's own parts. Each area adds its parts in `agent-native-parts/`.
 * Defined lazily: those modules import this one for `PartProps`.
 */
export const AGENT_NATIVE_PART_SET: PartSet = {
  name: "agent-native",
  get parts() {
    return agentNativeParts();
  },
};

export class MissingPartError extends Error {
  constructor(
    readonly part: string,
    readonly partSet: string,
  ) {
    super(`No component draws part "${part}" in the ${partSet} part set`);
    this.name = "MissingPartError";
  }
}

export class MissingEffectError extends Error {
  constructor(
    readonly rowId: string,
    readonly effect: string,
  ) {
    super(`Row ${rowId} runs ${effect}, which no model runtime handles`);
    this.name = "MissingEffectError";
  }
}

export interface ModelRuntime {
  navigate?: ((to: string, row: ModelRow) => void) | undefined;
  /** Handlers for `{ kind: "action", effectId }` rows, by effect id. */
  actions?: Readonly<Record<string, (row: ModelRow) => void>> | undefined;
  /** Opens the row with `target` id (a menu, a dialog, a submenu). */
  open?: ((target: string, row: ModelRow) => void) | undefined;
  /** App-specific content for rows with a `slot`, by slot key. */
  slots?:
    | Readonly<Record<string, ReactNode | ((row: ModelRow) => ReactNode)>>
    | undefined;
}

const ModelRuntimeContext = createContext<ModelRuntime>({});

const HostRowContext = createContext<ModelRow | null>(null);

export class UndeclaredNestedSurfaceError extends Error {
  constructor(
    readonly hostId: string,
    readonly rowIds: readonly string[],
  ) {
    super(
      `A surface drawing ${rowIds.join(", ")} sits in the slot of row ${hostId}, which does not list them in \`hosts\``,
    );
    this.name = "UndeclaredNestedSurfaceError";
  }
}

export function usePart(part: string): PartComponent {
  const partSet = useDesignSystem()?.parts ?? AGENT_NATIVE_PART_SET;
  const component = partSet.parts[part];
  if (!component) throw new MissingPartError(part, partSet.name);
  return component;
}

/**
 * The row's effect as a handler, or undefined when the row has none. A row
 * whose effect nothing handles throws when it runs, rather than doing nothing.
 */
export function useRowEffect(row: ModelRow): (() => void) | undefined {
  const runtime = useContext(ModelRuntimeContext);
  const effect = row.effect;
  const run = useCallback(() => {
    if (!effect) return;
    if (effect.kind === "navigate") {
      if (!runtime.navigate) throw new MissingEffectError(row.id, "navigate");
      runtime.navigate(effect.to, row);
      return;
    }
    if (effect.kind === "open") {
      if (!runtime.open) throw new MissingEffectError(row.id, "open");
      runtime.open(effect.target, row);
      return;
    }
    const handler = runtime.actions?.[effect.effectId];
    if (!handler) {
      throw new MissingEffectError(row.id, `action ${effect.effectId}`);
    }
    handler(row);
  }, [effect, row, runtime]);
  return effect ? run : undefined;
}

function slotContent(
  runtime: ModelRuntime,
  row: ModelRow,
  slot: string,
): ReactNode {
  const content = runtime.slots?.[slot];
  if (content === undefined) {
    throw new Error(
      `Row ${row.id} has slot "${slot}", which the app did not fill`,
    );
  }
  return (
    <HostRowContext.Provider value={row}>
      {typeof content === "function" ? content(row) : content}
    </HostRowContext.Provider>
  );
}

/** The app's content for a row's slot. A named slot nobody filled throws. */
export function useRowSlot(row: ModelRow): ReactNode {
  const runtime = useContext(ModelRuntimeContext);
  if (!row.slot) return null;
  return slotContent(runtime, row, row.slot);
}

/**
 * The app's content for each region a part draws, by region: null where the
 * row has none. A row with a region the part does not list throws, as does
 * a region whose slot nobody filled.
 */
export function useRowRegions<const Region extends string>(
  row: ModelRow,
  drawn: readonly Region[],
): Record<Region, ReactNode> {
  const runtime = useContext(ModelRuntimeContext);
  const regions: Readonly<Partial<Record<string, string>>> = row.regions ?? {};
  for (const region of Object.keys(regions)) {
    if (!(drawn as readonly string[]).includes(region)) {
      throw new Error(
        `Row ${row.id} has region "${region}", which part ${row.part} does not draw`,
      );
    }
  }
  const content = {} as Record<Region, ReactNode>;
  for (const region of drawn) {
    const slot = regions[region];
    content[region] =
      slot === undefined ? null : slotContent(runtime, row, slot);
  }
  return content;
}

/**
 * Rows and the runtime they need, built by the component that owns them, so
 * a row whose state lives in one component can join a group drawn by another.
 */
export interface ModelFragment {
  rows: readonly ModelRow[];
  actions?: ModelRuntime["actions"];
  slots?: ModelRuntime["slots"];
}

function mergeKeys<Value>(
  kind: string,
  records: ReadonlyArray<Readonly<Record<string, Value>> | undefined>,
): Record<string, Value> | undefined {
  const merged: Record<string, Value> = {};
  let any = false;
  for (const record of records) {
    if (!record) continue;
    for (const [key, value] of Object.entries(record)) {
      if (key in merged) {
        throw new Error(`Two model fragments both define ${kind} "${key}"`);
      }
      merged[key] = value;
      any = true;
    }
  }
  return any ? merged : undefined;
}

/**
 * The actions and slots of several fragments as one runtime, for the surface
 * that draws their rows. Two fragments defining the same key throw: one of
 * them would silently lose its handler or its content.
 */
export function combineFragments(
  fragments: readonly ModelFragment[],
): Required<Pick<ModelFragment, "rows">> &
  Pick<ModelRuntime, "actions" | "slots"> {
  return {
    rows: fragments.flatMap((fragment) => fragment.rows),
    actions: mergeKeys(
      "action",
      fragments.map((fragment) => fragment.actions),
    ),
    slots: mergeKeys(
      "slot",
      fragments.map((fragment) => fragment.slots),
    ),
  };
}

function ModelRowView({ row }: { row: ModelRow }) {
  const Part = usePart(row.part);
  return (
    <Part row={row}>
      {row.rows && row.rows.length > 0 ? <ModelRows rows={row.rows} /> : null}
    </Part>
  );
}

export function ModelRows({ rows }: { rows: readonly ModelRow[] }) {
  return (
    <>
      {rows.map((row) => (
        <ModelRowView key={row.id} row={row} />
      ))}
    </>
  );
}

export interface ModelSurfaceProps extends ModelRuntime {
  model: ScreenModel;
}

/**
 * Draws a screen model with the current part set. The model is validated
 * once per model object; an invalid one throws with every issue listed.
 */
export function ModelSurface({ model, ...runtime }: ModelSurfaceProps) {
  const valid = useMemo(() => assertValidModel(model), [model]);
  const host = useContext(HostRowContext);
  if (host && host.hosts !== "any") {
    const hosted = host.hosts ?? [];
    const undeclared = valid.rows
      .map((row) => row.id)
      .filter((id) => !hosted.includes(id));
    if (undeclared.length > 0) {
      throw new UndeclaredNestedSurfaceError(host.id, undeclared);
    }
  }
  const { navigate, actions, open, slots } = runtime;
  const value = useMemo<ModelRuntime>(
    () => ({ navigate, actions, open, slots }),
    [navigate, actions, open, slots],
  );
  return (
    <ModelRuntimeContext.Provider value={value}>
      <HostRowContext.Provider value={null}>
        <ModelRows rows={valid.rows} />
      </HostRowContext.Provider>
    </ModelRuntimeContext.Provider>
  );
}

const WHOLE_PART_NAMES: Readonly<Record<string, string>> = {
  SettingsSections: "settings",
  Sidebar: "sidebar",
  AppShell: "app-shell",
};

function wholePartName(name: string): string {
  const part = WHOLE_PART_NAMES[name];
  if (!part) {
    throw new Error(
      `"${name}" is not a whole part; use ${Object.keys(WHOLE_PART_NAMES).join(", ")}`,
    );
  }
  return part;
}

/**
 * @deprecated Use `defineDesignSystem({ parts: definePartSet({ name, parts,
 * whole }) })`. Takes whole parts by their earlier names (`SettingsSections`,
 * `Sidebar`, `AppShell`) and draws every row part with toolkit's.
 */
export function withDesignSystemParts(
  name: string,
  parts: Readonly<Record<string, ComponentType<never>>>,
): DesignSystemDefinition {
  const whole: Partial<WholeParts> = Object.fromEntries(
    Object.entries(parts).map(([key, part]) => [wholePartName(key), part]),
  );
  return {
    name,
    parts: {
      name,
      get parts() {
        return AGENT_NATIVE_PART_SET.parts;
      },
      whole,
    },
  };
}

/** @deprecated Use `useWholePart` with the part name (`settings`). */
export function useDesignSystemPart<Props>(
  name: string,
): ComponentType<Props> | undefined {
  const whole: Readonly<Partial<Record<string, unknown>>> =
    useDesignSystem()?.parts?.whole ?? {};
  return whole[wholePartName(name)] as ComponentType<Props> | undefined;
}

export { rowAttributes };
