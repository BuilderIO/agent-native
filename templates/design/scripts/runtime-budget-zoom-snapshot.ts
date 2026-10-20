import type { MultiScreenCanvasGroupedProps } from "../app/components/design/multi-screen/types";

export type ZoomSnapshot = {
  sampledAt: number;
  sampleRevision: number;
  renderRevision: number;
  committedCanvasScale: number;
  camera: { sampleRevision: number; scale: number; transform: string };
  basis: {
    sampleRevision: number;
    screenId: string | null;
    frameWidth: number | null;
    sourceWidth: number | null;
    scale: number;
  };
  routeZoom: number | null;
  label: string | null;
};

type Fiber = {
  return: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
  memoizedProps: unknown;
  stateNode: { current?: Fiber } | null;
};

export type ZoomSnapshotConfig = {
  readout: Element | null;
  defaultFrameWidth: number;
  defaultSourceWidth: number;
  deviceWidths: Record<string, number>;
};

// Passed directly to page.evaluate: all browser reads happen in one JS task.
export function readRuntimeZoomSnapshot(
  config: ZoomSnapshotConfig,
): ZoomSnapshot | null {
  const world = document.querySelector<HTMLElement>(
    "[data-multi-screen-canvas-world]",
  );
  if (!world) return null;
  const fiberKey = Object.keys(world).find((key) =>
    key.startsWith("__reactFiber$"),
  );
  if (!fiberKey)
    throw new Error("runtime zoom measurement requires React host fibers");
  const host = (world as unknown as Record<string, Fiber>)[fiberKey]!;
  const candidates = new Set<MultiScreenCanvasGroupedProps>();
  for (const start of [host, host.alternate]) {
    const path: Fiber[] = [];
    for (let node = start; node; node = node.return) path.push(node);
    const root = path.pop()?.stateNode?.current;
    if (!root) continue;
    let current = root;
    let canvasProps: MultiScreenCanvasGroupedProps | null = null;
    let connected = true;
    // Bailouts share children whose return pointers can still name an older
    // parent. Resolve the path downward from root.current instead of treating
    // that upward chain as the committed tree.
    for (const ancestor of path.reverse()) {
      let child = current.child;
      while (child && child !== ancestor && child !== ancestor.alternate)
        child = child.sibling;
      if (!child) {
        connected = false;
        break;
      }
      current = child;
      const props =
        current.memoizedProps as Partial<MultiScreenCanvasGroupedProps> | null;
      if (
        props &&
        Array.isArray(props.screens) &&
        typeof props.zoom === "number" &&
        "activeId" in props
      ) {
        canvasProps = props as MultiScreenCanvasGroupedProps;
      }
    }
    if (connected && current.stateNode === (world as unknown) && canvasProps)
      candidates.add(canvasProps);
  }
  if (candidates.size !== 1) return null;
  const props = [...candidates][0]!;
  if (props.interactScreenId)
    throw new Error("runtime zoom measurement requires overview mode");
  const screen =
    props.screens.find(
      (screen) =>
        screen.id === props.activeId && screen.id !== props.board?.boardFileId,
    ) ?? props.screens.find((screen) => screen.id !== props.board?.boardFileId);
  const device = props.previewDeviceFrame ?? "none";
  const frameWidth = screen
    ? (props.geometry?.geometryById?.[screen.id]?.width ??
      config.defaultFrameWidth)
    : null;
  const sourceWidth = screen
    ? device === "none"
      ? (screen.width ?? config.defaultSourceWidth)
      : config.deviceWidths[device]
    : null;
  if (screen && (!(frameWidth! > 0) || !(sourceWidth! > 0)))
    throw new Error("runtime zoom basis is invalid");
  const transform = world.style.transform;
  if (!transform) return null;
  const cameraScale = new DOMMatrixReadOnly(transform).a * 100;
  const targetWindow = window as unknown as {
    __runtimeBudgetZoom?: {
      renderRevisions: WeakMap<object, number>;
      nextRenderRevision: number;
      nextSampleRevision: number;
    };
  };
  const state = (targetWindow.__runtimeBudgetZoom ??= {
    renderRevisions: new WeakMap(),
    nextRenderRevision: 0,
    nextSampleRevision: 0,
  });
  let renderRevision = state.renderRevisions.get(props);
  if (renderRevision === undefined) {
    renderRevision = ++state.nextRenderRevision;
    state.renderRevisions.set(props, renderRevision);
  }
  const sampleRevision = ++state.nextSampleRevision;
  const raw = new URLSearchParams(location.search).get("zoom");
  const routeZoom = raw === null ? Number.NaN : Number(raw);
  return {
    sampledAt: performance.now(),
    sampleRevision,
    renderRevision,
    committedCanvasScale: props.zoom,
    camera: { sampleRevision, scale: cameraScale, transform },
    basis: {
      sampleRevision,
      screenId: screen?.id ?? null,
      frameWidth,
      sourceWidth: sourceWidth ?? null,
      scale: screen ? frameWidth! / sourceWidth! : 1,
    },
    routeZoom: Number.isFinite(routeZoom) && routeZoom > 0 ? routeZoom : null,
    label: config.readout?.isConnected
      ? (config.readout.textContent?.trim() ?? null)
      : null,
  };
}
