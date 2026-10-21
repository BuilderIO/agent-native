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

export type FiberPathFailure = {
  branch: "host" | "alternate";
  reason:
    | "root-unavailable"
    | "path-disconnected"
    | "world-mismatch"
    | "canvas-props-missing";
};

export type ZoomFailureCause = {
  type: "timeout" | "error";
  name: string;
  message: string;
};

export type ZoomSnapshotRead =
  | { status: "available"; snapshot: ZoomSnapshot }
  | {
      status: "unavailable";
      reason:
        | "world-absent"
        | "toolbar-absent"
        | "attempt-deadline-exceeded"
        | "active-screen-unresolved"
        | "camera-transform-absent";
      activeId?: string | null;
    }
  | {
      status: "error";
      reason:
        | "fiber-host-missing"
        | "fiber-path-unreadable"
        | "fiber-candidates-ambiguous"
        | "overview-mode-required"
        | "camera-transform-unreadable"
        | "snapshot-read-timed-out"
        | "snapshot-read-failed";
      message?: string;
      cause?: ZoomFailureCause;
      paths?: FiberPathFailure[];
      candidateCount?: number;
      transform?: string;
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
  readout: Node | null;
  defaultFrameWidth: number;
  defaultSourceWidth: number;
  deviceWidths: Record<string, number>;
};

// Passed directly to page.evaluate: all browser reads happen in one JS task.
export function readRuntimeZoomSnapshot(
  config: ZoomSnapshotConfig,
): ZoomSnapshotRead {
  const world = document.querySelector<HTMLElement>(
    "[data-multi-screen-canvas-world]",
  );
  if (!world) return { status: "unavailable", reason: "world-absent" };
  const fiberKey = Object.keys(world).find((key) =>
    key.startsWith("__reactFiber$"),
  );
  if (!fiberKey) return { status: "error", reason: "fiber-host-missing" };
  const host = (world as unknown as Record<string, Fiber>)[fiberKey]!;
  const candidates = new Set<MultiScreenCanvasGroupedProps>();
  const paths: FiberPathFailure[] = [];
  for (const [index, start] of [host, host.alternate].entries()) {
    if (!start) continue;
    const branch = index === 0 ? "host" : "alternate";
    const path: Fiber[] = [];
    for (let node: Fiber | null = start; node; node = node.return)
      path.push(node);
    const root = path.pop()?.stateNode?.current;
    if (!root) {
      paths.push({ branch, reason: "root-unavailable" });
      continue;
    }
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
    if (!connected) paths.push({ branch, reason: "path-disconnected" });
    else if (current.stateNode !== (world as unknown))
      paths.push({ branch, reason: "world-mismatch" });
    else if (!canvasProps)
      paths.push({ branch, reason: "canvas-props-missing" });
    else candidates.add(canvasProps);
  }
  if (candidates.size === 0)
    return { status: "error", reason: "fiber-path-unreadable", paths };
  if (candidates.size > 1)
    return {
      status: "error",
      reason: "fiber-candidates-ambiguous",
      candidateCount: candidates.size,
      paths,
    };
  const props = [...candidates][0]!;
  if (props.interactScreenId)
    return { status: "error", reason: "overview-mode-required" };
  // Before the active-file effect settles, the editor can use its default file
  // while activeId is still absent or stale. Those effective-file inputs are
  // not canvas props, so wait for a resolved ID rather than guessing its basis.
  // The fixed benchmark session zooms only HTML screens or the board.
  if (
    props.screens.length > 0 &&
    (!props.activeId ||
      (!props.screens.some((screen) => screen.id === props.activeId) &&
        props.activeId !== props.board?.boardFileId))
  )
    return {
      status: "unavailable",
      reason: "active-screen-unresolved",
      activeId: props.activeId,
    };
  const screen =
    props.screens.find(
      (screen) =>
        screen.id === props.activeId && screen.id !== props.board?.boardFileId,
    ) ?? props.screens.find((screen) => screen.id !== props.board?.boardFileId);
  const device = props.previewDeviceFrame ?? "none";
  const rawFrameWidth = screen
    ? props.geometry?.geometryById?.[screen.id]?.width
    : undefined;
  const rawSourceWidth = screen
    ? device === "none"
      ? screen.width
      : config.deviceWidths[device]
    : undefined;
  const frameWidth = screen
    ? typeof rawFrameWidth === "number" && rawFrameWidth > 0
      ? rawFrameWidth
      : config.defaultFrameWidth
    : null;
  const sourceWidth = screen
    ? typeof rawSourceWidth === "number" && rawSourceWidth > 0
      ? rawSourceWidth
      : config.defaultSourceWidth
    : null;
  const transform = world.style.transform;
  if (!transform)
    return { status: "unavailable", reason: "camera-transform-absent" };
  let cameraScale: number;
  try {
    cameraScale = new DOMMatrixReadOnly(transform).a * 100;
  } catch (cause) {
    return {
      status: "error",
      reason: "camera-transform-unreadable",
      message: String(cause),
      transform,
    };
  }
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
  const snapshot: ZoomSnapshot = {
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
  return { status: "available", snapshot };
}
