import { RADIUS_STEPS } from "@agent-native/design-system";
import {
  IconArrowsMove,
  IconPointer,
  IconSelectAll,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react";
import * as React from "react";

import { AgentNativeIcon } from "../../../src/app/shared/AgentNativeIcon.js";
import { IconButton } from "../../../src/ui/base-ui/button.js";
import {
  dockGroups,
  updateDockNode,
} from "../../../src/ui/base-ui/dock-layout.js";
import {
  DockWorkspace,
  restoreDockSurface,
  isDockLayout,
  type DockLayout,
} from "../../../src/ui/base-ui/dock-workspace.js";
import { indexLayers } from "../../../src/ui/base-ui/layer-tree-model.js";
import {
  type AutoLayoutValue,
  type PropertyEdit,
} from "../../../src/ui/base-ui/layout-properties.js";
import { Grid, Inline } from "../../../src/ui/base-ui/layout.js";
import {
  equalPaintStacks,
  paintBackground,
  type Paint,
} from "../../../src/ui/base-ui/paint-editor.js";
import { resolvePropertyToken } from "../../../src/ui/base-ui/property-token.js";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "../../../src/ui/base-ui/segmented-control.js";
import { SplitPane } from "../../../src/ui/base-ui/split-pane.js";
import {
  Tabs,
  TabsList,
  TabsTab,
  TabsPanel,
} from "../../../src/ui/base-ui/tabs.js";
import {
  initialLayers,
  prototypePages,
  homeSelection,
  originalGeometry,
  scene,
  type WorkspaceLayer,
  type LayerGeometry,
} from "./editor-workspace-fixture.js";
import { WorkspaceLayersPanel as LayersPanel } from "./editor-workspace-layers.js";
import { WorkspaceInspector } from "./workspace-inspector.js";

import "./editor-workspace.css";

interface DocumentState {
  layers: WorkspaceLayer[];
  geometry: ReadonlyMap<string, LayerGeometry>;
}
type Update = (g: LayerGeometry) => LayerGeometry;
function editValue<T>(
  update: (g: LayerGeometry, value: T) => LayerGeometry,
  value: T,
): Update {
  return (geometry) => update(geometry, value);
}
interface Preview {
  update: Update;
  targets: ReadonlySet<string>;
}
const viewport = "(max-width: 800px)";
function subscribe(n: () => void) {
  const m = window.matchMedia(viewport);
  m.addEventListener("change", n);
  return () => m.removeEventListener("change", n);
}
const steps = [20, 25, 35, 50, 75, 100] as const;
function frameValue(doc: DocumentState, layer: WorkspaceLayer) {
  return doc.geometry.get(layer.id) ?? originalGeometry(layer);
}
const workspaceRadiusTokens = RADIUS_STEPS.map((value, index) => ({
  id: "radius-" + (index + 1),
  label: "Radius " + (index + 1),
  value,
}));
const workspaceTokens = [
  { id: "surface", label: "Surface", value: "var(--surface-raised)" },
  { id: "subtle", label: "Subtle", value: "var(--surface-sunken)" },
  { id: "ink", label: "Ink", value: "var(--fg-default)" },
];
const emptyPaints: readonly Paint[] = [];
const prototypePaints = workspaceTokens.map(
  (token) =>
    [
      {
        id: "base",
        kind: "solid",
        color: { token: token.id, value: token.value },
        visible: true,
        opacity: 100,
      },
    ] as const,
);
function layerPaint(
  layer: WorkspaceLayer,
  geometry: LayerGeometry,
): readonly Paint[] {
  if (geometry.paints !== null) return geometry.paints;
  if (layer.sourceId === "cta-primary") return prototypePaints[2];
  const appearance = scene.get(layer.sourceId)?.[4];
  if (appearance === "p-card" || appearance === "p-feat")
    return prototypePaints[1];
  return ["nav", "home"].includes(layer.sourceId)
    ? prototypePaints[0]
    : emptyPaints;
}
const automatic: AutoLayoutValue = {
  mode: "row",
  alignment: { align: "center", justify: "start" },
  grid: { columns: 2, rows: "auto" },
  paddingX: 16,
  paddingY: 0,
  gap: 12,
  wrap: false,
  clip: false,
};
function TemplatePreview({ kind }: { kind: string }) {
  const cells =
    kind === "calendar"
      ? 21
      : kind === "mail"
        ? 4
        : kind === "analytics"
          ? 7
          : kind === "slides"
            ? 4
            : kind === "clips"
              ? 1
              : 6;
  return (
    <span aria-hidden className={"workspace-template-art art-" + kind}>
      {Array.from({ length: cells }, (_, i) => (
        <i
          key={i}
          style={
            kind === "analytics"
              ? { height: [40, 64, 52, 80, 58, 92, 70][i] + "%" }
              : undefined
          }
        />
      ))}
    </span>
  );
}
const Artwork = React.memo(function Artwork({
  sourceId,
  hasChildren,
}: {
  sourceId: string;
  hasChildren: boolean;
}) {
  const source = scene.get(sourceId);
  const text = source?.[6];
  if (source?.[4] === "p-tpl")
    return <TemplatePreview kind={sourceId.slice(4)} />;
  switch (sourceId) {
    case "tpl-tabs":
      return "All　　 Work　　 Create　　 Data";
    case "card-actions-code":
      return (
        <code>
          {
            'export const refundOrder = defineAction({\n  input: z.object({ amount: z.number() }),\n  policy: "requires-approval",\n})'
          }
        </code>
      );
    case "nav":
      return <span className="workspace-login">Log in</span>;
    case "ic-nav-logo":
      return <AgentNativeIcon aria-hidden width="100%" height="100%" />;
    case "hero-eyebrow":
      return hasChildren ? null : text;
    case "nav-logo":
      if (hasChildren) return null;
      return (
        <>
          <AgentNativeIcon aria-hidden size="1em" /> Agent-Native
        </>
      );
    case "logos":
      return (
        <span className="workspace-customer-logos">
          {["Northwind", "Halcyon", "Parcel", "Meridian", "Lumen", "Quill"].map(
            (c) => (
              <b key={c}>{c}</b>
            ),
          )}
        </span>
      );
    case "hero-cmd":
      return (
        <>
          <code>$ npx agent-native@latest create</code>
          <span>Copy</span>
        </>
      );
    case "how-tabs":
      return (
        <span className="workspace-recipe-steps">
          {["Define an action", "The agent calls it", "The UI calls it"].map(
            (t, i) => (
              <span key={t}>
                {i + 1}　{t}
              </span>
            ),
          )}
        </span>
      );
    case "how-code":
      return (
        <>
          <span className="workspace-code-head">actions/refund-order.ts</span>
          <code>
            {
              'export default defineAction({\n  name: "refund-order",\n  input: z.object({ orderId: z.string(), amount: z.number() }),\n  policy: "requires-approval",\n})'
            }
          </code>
        </>
      );
    case "foot":
      return (
        <span className="workspace-customer-logos">
          <b>Agent-Native</b>Product　 Developers　 Company
        </span>
      );
    default:
      return text;
  }
});
const CanvasLayerButton = React.memo(function CanvasLayerButton({
  layer,
  isSelected,
  locked,
  pan,
  onSelect,
  hasChildren,
  radius,
  stroke,
  shadow,
  login,
  paints,
}: Pick<LayerGeometry, "radius" | "stroke" | "shadow" | "login" | "paints"> & {
  layer: WorkspaceLayer;
  isSelected: boolean;
  locked: boolean;
  pan: boolean;
  onSelect: (id: string, extend: boolean) => void;
  hasChildren: boolean;
}) {
  const source = scene.get(layer.sourceId);
  const label = layer.sourceId === "hero-title" ? "Headline" : layer.name;
  const artwork = (
    <Artwork sourceId={layer.sourceId} hasChildren={hasChildren} />
  );
  return (
    <button
      type="button"
      tabIndex={-1}
      data-layer-id={layer.id}
      data-style={source?.[4]}
      data-source={layer.sourceId}
      aria-label={"Select " + label}
      aria-pressed={isSelected}
      aria-disabled={locked || undefined}
      className="workspace-art-layer"
      onClick={(e) => {
        if (!pan && !locked)
          onSelect(layer.id, e.shiftKey || e.metaKey || e.ctrlKey);
      }}
      style={{
        width: "100%",
        height: "100%",
        borderRadius: radius ? radius : undefined,
        boxShadow:
          [
            stroke ? "inset 0 0 0 " + stroke + "px var(--fg-default)" : "",
            shadow ? "0 3px " + shadow + "px var(--fg-muted)" : "",
          ]
            .filter(Boolean)
            .join(",") || undefined,
        fontSize: source?.[7],
        fontWeight: layer.sourceId === "nav-logo" ? 700 : source?.[8],
        textAlign:
          source?.[9] === "center"
            ? "center"
            : source?.[9] === "right"
              ? "right"
              : "left",
        background:
          paints === null
            ? undefined
            : paintBackground(paints, workspaceTokens),
      }}
    >
      {layer.sourceId === "nav" && !login ? null : source?.[4] === "p-code" ? (
        <span className="workspace-code-body">{artwork}</span>
      ) : (
        artwork
      )}
    </button>
  );
});

function Canvas({
  layers,
  doc,
  selectionIndex,
  currentSelection,
  onSelect,
  onAll,
  zoom,
  setZoom,
}: {
  layers: WorkspaceLayer[];
  doc: DocumentState;
  selectionIndex: ReadonlyMap<string, number>;
  currentSelection: readonly LayerGeometry[];
  onSelect: (id: string, extend: boolean) => void;
  onAll: () => void;
  zoom: number;
  setZoom: (n: number) => void;
}) {
  const root = layers[0];
  const [pan, setPan] = React.useState(false);
  const scroller = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const pageGeometry = React.useMemo(
    () => new Map(layers.map((layer) => [layer.id, frameValue(doc, layer)])),
    [doc, layers],
  );
  const byLayer = (layer: WorkspaceLayer) => {
    const position = selectionIndex.get(layer.id);
    if (position !== undefined) return currentSelection[position];
    const value = pageGeometry.get(layer.id);
    if (!value) throw new Error("Missing canvas layer geometry: " + layer.id);
    return value;
  };
  const paper = byLayer(root);
  const artWidth = Math.max(1, paper.width),
    artHeight = Math.max(1, paper.height);
  const factor = zoom / 100;
  const children = React.useMemo(() => {
    const map = new Map<string, WorkspaceLayer[]>();
    for (const l of layers) {
      if (l.parentId === null) continue;
      const siblings = map.get(l.parentId);
      if (siblings) siblings.push(l);
      else map.set(l.parentId, [l]);
    }
    return map;
  }, [layers]);
  function renderLayer(
    layer: WorkspaceLayer,
    flowChild: boolean,
    parentLocked: boolean,
  ): React.ReactNode {
    if (layer.hidden) return null;
    const geo = byLayer(layer),
      layout = geo.auto;
    const locked = !!layer.locked || parentLocked;
    const isSelected = selectionIndex.has(layer.id);
    return (
      <div
        key={layer.id}
        className="workspace-art-box"
        style={{
          position: flowChild ? "relative" : "absolute",
          left: flowChild ? undefined : geo.x,
          top: flowChild ? undefined : geo.y,
          width: geo.width,
          height: geo.height,
          flex: "none",
          transform:
            geo.rotation || geo.flipX || geo.flipY
              ? `rotate(${geo.rotation}deg) scale(${geo.flipX ? -1 : 1},${geo.flipY ? -1 : 1})`
              : undefined,
          mixBlendMode: geo.blend,
          filter: geo.state === "Hover" ? "brightness(.94)" : undefined,
          outline:
            geo.state === "Focus" ? "2px solid var(--line-focus)" : undefined,
          opacity: geo.opacity / 100,
        }}
      >
        <CanvasLayerButton
          layer={layer}
          isSelected={isSelected}
          locked={locked}
          pan={pan}
          onSelect={onSelect}
          hasChildren={!!children.get(layer.id)?.length}
          radius={resolvePropertyToken(
            { token: geo.radiusToken, value: geo.radius },
            workspaceRadiusTokens,
          )}
          stroke={geo.stroke}
          shadow={geo.shadow}
          login={geo.login}
          paints={geo.paints}
        />
        {!!children.get(layer.id)?.length && (
          <div
            className="workspace-frame-children"
            data-flow={layout?.mode}
            style={
              layout
                ? {
                    display: layout.mode === "grid" ? "grid" : "flex",
                    flexDirection: layout.mode === "column" ? "column" : "row",
                    flexWrap: layout.wrap ? "wrap" : "nowrap",
                    alignItems: layout.alignment.align,
                    justifyContent: layout.alignment.justify,
                    gridTemplateColumns:
                      "repeat(" + layout.grid.columns + ", minmax(0,1fr))",
                    gridTemplateRows:
                      layout.grid.rows === "auto"
                        ? undefined
                        : "repeat(" + layout.grid.rows + ",1fr)",
                    gap: layout.gap,
                    padding: layout.paddingY + "px " + layout.paddingX + "px",
                    overflow: layout.clip ? "hidden" : "visible",
                  }
                : geo.responsive && artWidth < geo.responsive.maxWidth
                  ? { insetInline: geo.responsive.padding }
                  : undefined
            }
          >
            {children
              .get(layer.id)
              ?.map((l) => renderLayer(l, !!layout, locked))}
          </div>
        )}
        {isSelected && selectionIndex.size === 1 && (
          <div
            aria-hidden
            className="workspace-selection-tag"
            style={{
              left: 0,
              top: 0,
              transform: "translateY(-100%) scale(" + 1 / factor + ")",
            }}
          >
            {layer.name}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="workspace-canvas">
      <div
        ref={scroller}
        className="workspace-scroller"
        role="region"
        aria-label="Design canvas"
        tabIndex={0}
        data-pan={pan || undefined}
        onPointerDown={(e) => {
          if (!pan) return;
          const n = e.currentTarget;
          n.setPointerCapture(e.pointerId);
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            left: n.scrollLeft,
            top: n.scrollTop,
          };
        }}
        onPointerMove={(e) => {
          if (drag.current) {
            e.currentTarget.scrollLeft =
              drag.current.left + drag.current.x - e.clientX;
            e.currentTarget.scrollTop =
              drag.current.top + drag.current.y - e.clientY;
          }
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div
          className="workspace-paper-viewport"
          style={{ width: artWidth * factor, height: artHeight * factor }}
        >
          <div
            className="workspace-paper"
            style={{
              width: artWidth,
              height: artHeight,
              transform: "scale(" + factor + ")",
            }}
          >
            {renderLayer(root, false, false)}
          </div>
        </div>
      </div>
      <Inline
        className="workspace-tools"
        gap={1}
        align="center"
        role="toolbar"
        aria-label="Canvas tools"
      >
        <SegmentedControl
          aria-label="Canvas tool"
          value={pan ? "pan" : "select"}
          onValueChange={(v) => setPan(v === "pan")}
        >
          <SegmentedControlItem
            value="select"
            title="Select"
            aria-label="Select tool"
          >
            <IconPointer />
          </SegmentedControlItem>
          <SegmentedControlItem value="pan" title="Pan" aria-label="Pan tool">
            <IconArrowsMove />
          </SegmentedControlItem>
        </SegmentedControl>
        <IconButton
          variant="ghost"
          color="gray"
          aria-label="Select page layers"
          title="Select page layers"
          onClick={onAll}
        >
          <IconSelectAll />
        </IconButton>
        <span className="workspace-tool-divider" />
        <IconButton
          variant="ghost"
          color="gray"
          aria-label="Zoom out"
          disabled={zoom === steps[0]}
          onClick={() =>
            setZoom(steps[steps.indexOf(zoom as (typeof steps)[number]) - 1])
          }
        >
          <IconZoomOut />
        </IconButton>
        <span className="workspace-zoom">{zoom}%</span>
        <IconButton
          variant="ghost"
          color="gray"
          aria-label="Zoom in"
          disabled={zoom === 100}
          onClick={() =>
            setZoom(steps[steps.indexOf(zoom as (typeof steps)[number]) + 1])
          }
        >
          <IconZoomIn />
        </IconButton>
      </Inline>
    </div>
  );
}

const defaultDock: DockLayout = {
  type: "split",
  id: "left",
  axis: "inline",
  side: "start",
  size: 280,
  first: {
    type: "group",
    id: "navigation",
    tabs: ["layers", "library", "agent"],
    active: "layers",
  },
  second: {
    type: "split",
    id: "right",
    axis: "inline",
    side: "end",
    size: 280,
    first: {
      type: "surface",
      id: "document",
      panel: "canvas",
    },
    second: {
      type: "group",
      id: "properties",
      tabs: ["inspector"],
      active: "inspector",
    },
  },
};
function initialDock(narrow: boolean): DockLayout {
  if (narrow)
    return {
      type: "split",
      id: "workspace",
      axis: "block",
      side: "end",
      size: 240,
      first: { type: "surface", id: "document", panel: "canvas" },
      second: {
        type: "group",
        id: "tools",
        tabs: ["layers", "library", "agent", "inspector"],
        active: "layers",
      },
    };
  return defaultDock;
}
function dockStorageKey(narrow: boolean) {
  return narrow
    ? "storybook.editor-workspace.dock.compact.v1"
    : "storybook.editor-workspace.dock.v1";
}
function readDock(narrow: boolean) {
  try {
    const saved = localStorage.getItem(dockStorageKey(narrow));
    if (saved === null) return { layout: initialDock(narrow), notice: "" };
    const layout: unknown = JSON.parse(saved);
    if (
      isDockLayout(layout, [
        "layers",
        "library",
        "agent",
        "canvas",
        "inspector",
      ])
    )
      return { layout: restoreDockSurface(layout, "canvas"), notice: "" };
    throw new Error("Unknown layout");
  } catch {
    return {
      layout: initialDock(narrow),
      notice: "Saved layout unavailable. Showing the default layout.",
    };
  }
}
type GeometryPanels = { canvas: React.ReactNode; inspector: React.ReactNode };
const GeometryPanelContext = React.createContext<GeometryPanels | null>(null);
function GeometryPanel({ name }: { name: keyof GeometryPanels }) {
  const panels = React.useContext(GeometryPanelContext);
  if (!panels) throw new Error("Geometry panel requires the workspace context");
  return panels[name];
}
function DockDemo({
  narrow,
  layersProps,
  canvas,
  inspector,
}: {
  narrow: boolean;
  layersProps: React.ComponentProps<typeof LayersPanel>;
  canvas: React.ReactNode;
  inspector: React.ReactNode;
}) {
  const [desktop, setDesktop] = React.useState(() => readDock(false));
  const [compact, setCompact] = React.useState(() => readDock(true));
  const state = narrow ? compact : desktop;
  const setState = narrow ? setCompact : setDesktop;
  const change = React.useCallback(
    (layout: DockLayout) => {
      try {
        localStorage.setItem(dockStorageKey(narrow), JSON.stringify(layout));
        setState({ layout, notice: "" });
      } catch {
        setState({
          layout,
          notice:
            "Layout updated for this session. Browser storage is unavailable.",
        });
      }
    },
    [narrow, setState],
  );
  const revealLayers = React.useCallback(() => {
    const group = dockGroups(state.layout).find((g) =>
      g.tabs.includes("layers"),
    );
    if (group && group.active !== "layers")
      change(
        updateDockNode(state.layout, group.id, () => ({
          ...group,
          active: "layers",
        })),
      );
  }, [change, state.layout]);
  const renderPanels = React.useCallback<
    NonNullable<React.ComponentProps<typeof LayersPanel>["renderPanels"]>
  >(
    ({ layers, library, agent }) => (
      <DockWorkspace
        snapToStep
        panels={[
          { id: "layers", label: "Layers", content: layers },
          { id: "library", label: "Library", content: library },
          { id: "agent", label: "Agent", content: agent },
          {
            id: "canvas",
            label: "Canvas",
            content: <GeometryPanel name="canvas" />,
          },
          {
            id: "inspector",
            label: "Inspector",
            content: <GeometryPanel name="inspector" />,
          },
        ]}
        layout={state.layout}
        label="Dockable workspace"
        onLayoutChange={change}
        onReset={() => change(initialDock(narrow))}
      />
    ),
    [change, narrow, state.layout],
  );
  return (
    <div className="min-h-0 min-w-0">
      {state.notice && <div role="status">{state.notice}</div>}
      <GeometryPanelContext.Provider value={{ canvas, inspector }}>
        <LayersPanel
          {...layersProps}
          onRevealLayers={revealLayers}
          renderPanels={renderPanels}
        />
      </GeometryPanelContext.Provider>
    </div>
  );
}
interface EditorWorkspaceProps {
  dockable?: boolean;
  initialSelection?: "nav" | "hundred";
  inspectorOnly?: boolean;
}

export function EditorWorkspace({
  initialSelection = "nav",
  inspectorOnly = false,
  dockable = false,
}: EditorWorkspaceProps): React.JSX.Element {
  const [history, setHistory] = React.useState<{
    doc: DocumentState;
    past: DocumentState[];
    future: DocumentState[];
  }>(() => ({
    doc: {
      layers: initialSelection === "hundred" ? initialLayers : prototypePages,
      geometry: new Map(),
    },
    past: [],
    future: [],
  }));
  const { doc } = history;
  const [requestedSelection, setSelected] = React.useState<readonly string[]>(
    initialSelection === "hundred" ? homeSelection : ["nav"],
  );
  const fileSeparator = React.useRef<HTMLDivElement>(null);
  const [toolsHeight, setToolsHeight] = React.useState(280);
  const [layersWidth, setLayersWidth] = React.useState(320);
  const [requestedPage, setPageId] = React.useState("home");
  const pageSelections = React.useRef(
    new Map<string, readonly string[]>([["home", requestedSelection]]),
  );
  const [zoom, setZoom] = React.useState(35);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const narrow = React.useSyncExternalStore(
    subscribe,
    () => matchMedia(viewport).matches,
    () => false,
  );
  const { byId, groups, owners, locked } = React.useMemo(() => {
    const { byId, order } = indexLayers(doc.layers);
    const locked = new Set<string>();
    const groups = new Map<string, WorkspaceLayer[]>(),
      owners = new Map<string, string>();
    for (const layer of order) {
      const page =
        layer.parentId === null ? layer.id : owners.get(layer.parentId);
      if (page === undefined) throw new Error("Missing layer page");
      owners.set(layer.id, page);
      if (
        layer.locked ||
        (layer.parentId !== null && locked.has(layer.parentId))
      )
        locked.add(layer.id);
      const existing = groups.get(page);
      if (existing) existing.push(layer);
      else groups.set(page, [layer]);
    }
    return { byId, groups, owners, locked };
  }, [doc.layers]);
  const fallbackPage = !groups.has(requestedPage)
    ? Array.from(pageSelections.current.keys())
        .reverse()
        .find((id) => groups.has(id))
    : undefined;
  const pageId = fallbackPage ?? requestedPage;
  const selected = fallbackPage
    ? (pageSelections.current.get(fallbackPage) ?? [fallbackPage])
    : requestedSelection;
  const selectedLayers = React.useMemo(
    () =>
      selected.flatMap((id) => {
        const l = byId.get(id);
        return l ? [l] : [];
      }),
    [selected, byId],
  );
  const selectionIndex = React.useMemo(
    () => new Map(selectedLayers.map((layer, index) => [layer.id, index])),
    [selectedLayers],
  );
  const pick = React.useCallback(
    (ids: readonly string[]) => {
      setPreview(null);
      setSelected(ids);
      const last = ids.at(-1);
      if (last) {
        const page = owners.get(last);
        if (page) {
          pageSelections.current.delete(page);
          pageSelections.current.set(page, ids);
          setPageId(page);
        }
      }
    },
    [owners],
  );
  const commit = React.useCallback(
    (update: (d: DocumentState) => DocumentState) => {
      setHistory((h) => {
        const next = update(h.doc);
        return next === h.doc
          ? h
          : { doc: next, past: [...h.past, h.doc], future: [] };
      });
    },
    [],
  );
  const setLayers = React.useCallback(
    (layers: WorkspaceLayer[]) => commit((d) => ({ ...d, layers })),
    [commit],
  );
  const pickPage = React.useCallback((id: string) => pick([id]), [pick]);
  const current = groups.get(pageId) ?? groups.get("home");
  if (!current) throw new Error("Missing Home page");
  const selectPage = () => pick(current.map((l) => l.id));
  const editableLayers = React.useMemo(
    () => selectedLayers.filter((layer) => !locked.has(layer.id)),
    [selectedLayers, locked],
  );
  const targets = React.useMemo(
    () => new Set(editableLayers.map((l) => l.id)),
    [editableLayers],
  );
  const originalSelection = React.useMemo(
    () => selectedLayers.map((layer) => frameValue(doc, layer)),
    [doc, selectedLayers],
  );
  const currentSelection = React.useMemo(() => {
    if (!preview) return originalSelection;
    if (
      preview.targets === targets &&
      editableLayers.length === selectedLayers.length
    )
      return originalSelection.map(preview.update);
    return originalSelection.map((geometry, i) =>
      preview.targets.has(selectedLayers[i].id)
        ? preview.update(geometry)
        : geometry,
    );
  }, [originalSelection, preview, selectedLayers, targets, editableLayers]);
  let firstFill: readonly Paint[] | undefined;
  let fills: readonly Paint[] | null = null;
  for (let i = 0; i < selectedLayers.length; i++) {
    const layer = selectedLayers[i];
    if (editableLayers.length && !targets.has(layer.id)) continue;
    const paint = layerPaint(layer, currentSelection[i]);
    firstFill ??= paint;
    if (!equalPaintStacks(firstFill, paint)) {
      fills = null;
      break;
    }
    fills = firstFill;
  }
  const title =
    selectedLayers.length === 1
      ? selectedLayers[0].name
      : selectedLayers.length + " selected";

  const apply = React.useCallback(
    (update: Update) => {
      setPreview(null);
      commit((d) => {
        let geometry: Map<string, LayerGeometry> | undefined;
        for (const l of editableLayers) {
          const old = frameValue(d, l),
            next = update(old);
          if (
            next !== old &&
            (Object.keys(next) as (keyof LayerGeometry)[]).some(
              (k) => !Object.is(old[k], next[k]),
            )
          ) {
            geometry ??= new Map(d.geometry);
            geometry.set(l.id, next);
          }
        }
        return geometry ? { ...d, geometry } : d;
      });
    },
    [commit, editableLayers],
  );
  const edit = React.useCallback(
    <T,>(
      e: PropertyEdit<T>,
      update: (g: LayerGeometry, v: T) => LayerGeometry,
    ) => {
      if (e.phase === "cancel") {
        setPreview(null);
        return;
      }
      const modify = editValue(update, e.value);
      if (e.phase === "preview")
        setPreview(targets.size ? { update: modify, targets } : null);
      else apply(modify);
    },
    [apply, targets],
  );
  function undo() {
    setPreview(null);
    setHistory((h) => {
      const previous = h.past.at(-1);
      return previous
        ? {
            doc: previous,
            past: h.past.slice(0, -1),
            future: [h.doc, ...h.future],
          }
        : h;
    });
  }
  function redo() {
    setPreview(null);
    setHistory((h) => {
      const next = h.future.at(0);
      return next
        ? { doc: next, past: [...h.past, h.doc], future: h.future.slice(1) }
        : h;
    });
  }
  const visibilityLayers = editableLayers.length
    ? editableLayers
    : selectedLayers;
  const visible = React.useMemo(() => {
    const hidden = !!visibilityLayers[0]?.hidden;
    return visibilityLayers.every((layer) => !!layer.hidden === hidden)
      ? !hidden
      : "mixed";
  }, [visibilityLayers]);
  const collapseLayers = React.useCallback(() => {
    fileSeparator.current?.focus();
    if (narrow) setToolsHeight(0);
    else setLayersWidth(0);
  }, [narrow]);
  const selectLayer = React.useCallback(
    (id: string, extend: boolean) => {
      pick(
        extend
          ? selectionIndex.has(id)
            ? selected.filter((i) => i !== id)
            : [...selected, id]
          : [id],
      );
    },
    [pick, selected, selectionIndex],
  );
  const layersProps = {
    layers: doc.layers,
    current,
    allPages: initialSelection === "hundred",
    selected,
    onSelection: pick,
    onChange: setLayers,
    onPage: pickPage,
    pageId,
  };
  const layers = <LayersPanel {...layersProps} onCollapse={collapseLayers} />;
  const canvas = (
    <Canvas
      layers={current}
      doc={doc}
      selectionIndex={selectionIndex}
      currentSelection={currentSelection}
      zoom={zoom}
      setZoom={setZoom}
      onAll={selectPage}
      onSelect={selectLayer}
    />
  );
  const properties = (
    <WorkspaceInspector
      layers={selectedLayers}
      current={currentSelection}
      lockedLayerIds={locked}
      title={title}
      visible={visible}
      setVisible={(on) =>
        setLayers(
          doc.layers.map((l) =>
            targets.has(l.id) ? { ...l, hidden: !on } : l,
          ),
        )
      }
      apply={apply}
      edit={edit}
      paints={fills}
      firstFill={firstFill ?? emptyPaints}
      tokens={workspaceTokens}
      radiusTokens={workspaceRadiusTokens}
      automatic={automatic}
      canUndo={!!history.past.length}
      canRedo={!!history.future.length}
      undo={undo}
      redo={redo}
    />
  );
  if (inspectorOnly)
    return (
      <div className="workspace-stage" style={{ width: "min(100%, 280px)" }}>
        {properties}
      </div>
    );
  return (
    <Grid
      data-testid="editor-workspace"
      className="workspace-stage"
      onKeyDown={(e) => {
        if (
          (e.target as HTMLElement).closest(
            "input,textarea,[contenteditable=true]",
          ) ||
          !(e.ctrlKey || e.metaKey)
        )
          return;
        if (e.key.toLowerCase() === "z") {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
        }
        if (e.key.toLowerCase() === "a") {
          e.preventDefault();
          selectPage();
        }
      }}
    >
      {dockable ? (
        <DockDemo
          narrow={narrow}
          layersProps={layersProps}
          canvas={canvas}
          inspector={properties}
        />
      ) : narrow ? (
        <SplitPane
          className="workspace-split-region"
          axis="block"
          side="end"
          label="Tool panel height"
          snapToStep
          separatorRef={fileSeparator}
          size={toolsHeight}
          onSizeChange={(size, { phase }) => {
            if (phase === "commit") setToolsHeight(size);
          }}
          minSize={128}
          minContentSize={144}
          collapsible
          pane={
            <Tabs
              variant="framed"
              defaultValue="file"
              className="workspace-mobile-tools"
            >
              <TabsList aria-label="Workspace tools">
                <TabsTab value="file">File</TabsTab>
                <TabsTab value="inspector">Inspector</TabsTab>
              </TabsList>
              <TabsPanel
                className="workspace-mobile-panel"
                value="file"
                keepMounted
              >
                {layers}
              </TabsPanel>
              <TabsPanel
                className="workspace-mobile-panel"
                value="inspector"
                keepMounted
              >
                {properties}
              </TabsPanel>
            </Tabs>
          }
        >
          {canvas}
        </SplitPane>
      ) : (
        <SplitPane
          className="workspace-split-region"
          pane={layers}
          separatorRef={fileSeparator}
          label="Layers panel width"
          size={layersWidth}
          onSizeChange={(size, { phase }) => {
            if (phase === "commit") setLayersWidth(size);
          }}
          minSize={200}
          maxSize={416}
          snapToStep
          minContentSize={(separatorSize) => 500 + separatorSize}
          collapsible
        >
          <SplitPane
            className="workspace-split-region"
            side="end"
            pane={properties}
            label="Properties panel width"
            defaultSize={280}
            minSize={280}
            maxSize={400}
            snapToStep
            minContentSize={220}
            collapsible
          >
            {canvas}
          </SplitPane>
        </SplitPane>
      )}
    </Grid>
  );
}
