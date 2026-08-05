/**
 * Headless canvas interaction primitives shared by visual editors.
 *
 * This module deliberately knows nothing about React, DOM elements, or how an
 * application persists objects. An app supplies its object adapter and turns
 * the returned semantic commands into its own mutations.
 */

export const DEFAULT_CANVAS_DRAG_THRESHOLD = 3;
export const DEFAULT_CANVAS_NUDGE = 1;
export const DEFAULT_CANVAS_ACCELERATED_NUDGE = 10;
export const DEFAULT_CANVAS_MIN_SIZE = 24;

export type CanvasTextActivation = "single-click" | "double-click";
export type CanvasEscapeBehavior =
  | "select-object"
  | "clear-selection"
  | "cancel-edit";
export type CanvasDuplicateModifier = "alt" | "meta" | "ctrl" | "none";
export type CanvasResizeHandle =
  | "nw"
  | "n"
  | "ne"
  | "w"
  | "e"
  | "sw"
  | "s"
  | "se";

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasRect extends CanvasPoint {
  width: number;
  height: number;
}

export interface CanvasViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export interface CanvasModifiers {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export interface CanvasTextEditPolicy {
  activation?: CanvasTextActivation;
  escapeBehavior?: CanvasEscapeBehavior;
}

export interface CanvasDragPolicy {
  threshold?: number;
  duplicateModifier?: CanvasDuplicateModifier;
}

export interface CanvasNudgePolicy {
  amount?: number;
  acceleratedAmount?: number;
}

/** The interaction surface an app can durably support. */
export interface CanvasInteractionCapabilities {
  selection: boolean;
  multiSelection: boolean;
  move: boolean;
  resize: boolean;
  textEditing: boolean;
  nudge: boolean;
  duplicate: boolean;
  clipboard: boolean;
  delete: boolean;
  arrange: boolean;
  snapping: boolean;
  alignment: boolean;
  distribution: boolean;
  grouping: boolean;
  rotation: boolean;
  marquee: boolean;
}

export const DEFAULT_CANVAS_INTERACTION_CAPABILITIES: CanvasInteractionCapabilities =
  {
    selection: true,
    multiSelection: false,
    move: true,
    resize: true,
    textEditing: true,
    nudge: true,
    duplicate: true,
    clipboard: true,
    delete: true,
    arrange: true,
    snapping: false,
    alignment: false,
    distribution: false,
    grouping: false,
    rotation: false,
    marquee: false,
  };

export interface CanvasInteractionConfig {
  capabilities?: Partial<CanvasInteractionCapabilities>;
  textEditing?: CanvasTextEditPolicy;
  drag?: CanvasDragPolicy;
  nudge?: CanvasNudgePolicy;
  minSize?: number;
  shortcuts?: readonly CanvasShortcut[];
}

/** The only persistence seam required by the shared interaction core. */
export interface CanvasInteractionAdapter<TObjectId = string> {
  readonly capabilities: CanvasInteractionCapabilities;
  dispatch(command: CanvasCommand<TObjectId>): CanvasCommandDispatchResult;
}

export type CanvasCommandDispatchResult =
  | { handled: true }
  | {
      handled: false;
      reason: "no-adapter" | "unsupported" | "unhandled";
    };

export type CanvasCommandId =
  | "select-all"
  | "undo"
  | "redo"
  | "copy"
  | "cut"
  | "paste"
  | "duplicate"
  | "delete"
  | "nudge"
  | "arrange-front"
  | "arrange-back"
  | "bring-forward"
  | "bring-to-front"
  | "send-backward"
  | "send-to-back"
  | "align-left"
  | "align-center"
  | "align-right"
  | "align-top"
  | "align-middle"
  | "align-bottom"
  | "distribute-horizontal"
  | "distribute-vertical"
  | "group"
  | "ungroup"
  | "frame-selection"
  | "escape"
  | "enter"
  | "nudge-left"
  | "nudge-right"
  | "nudge-up"
  | "nudge-down";

export interface CanvasCommand<TObjectId = string> {
  id: CanvasCommandId;
  objectIds?: readonly TObjectId[];
  delta?: CanvasPoint;
}

export type CanvasShortcutModifier =
  | "primary"
  | "shift"
  | "alt"
  | "ctrl"
  | "meta";

export interface CanvasShortcut {
  command: CanvasCommandId;
  key: string;
  /**
   * Optional physical key identity for shifted punctuation. `KeyboardEvent.key`
   * changes `]` to `}` under Shift, while `KeyboardEvent.code` stays stable.
   */
  code?: string;
  modifiers?: readonly CanvasShortcutModifier[];
}

export interface CanvasShortcutInput extends CanvasModifiers {
  key: string;
  code?: string;
}

export interface CanvasShortcutRegistry {
  readonly shortcuts: readonly CanvasShortcut[];
  resolve(input: CanvasShortcutInput): CanvasCommandId | null;
}

export interface CanvasTextActivationInput {
  clickCount: number;
  textEditable: boolean;
}

export type CanvasTextActivationResult = "edit" | "select";

export interface CanvasEscapeInput<TObjectId = string> {
  editingObjectId: TObjectId | null;
  selectedObjectIds?: readonly TObjectId[];
}

export type CanvasEscapeResult<TObjectId = string> =
  | {
      action: "select-object";
      editingObjectId: null;
      selectedObjectIds: readonly TObjectId[];
    }
  | {
      action: "cancel-edit";
      editingObjectId: null;
      selectedObjectIds: readonly TObjectId[];
    }
  | {
      action: "clear-selection";
      editingObjectId: null;
      selectedObjectIds: readonly TObjectId[];
    }
  | {
      action: "none";
      editingObjectId: null;
      selectedObjectIds: readonly TObjectId[];
    };

export interface CanvasResizeInput {
  handle: CanvasResizeHandle;
  delta: CanvasPoint;
  preserveAspectRatio?: boolean;
  minWidth?: number;
  minHeight?: number;
}

export interface CanvasNudgeInput extends CanvasModifiers {
  key: string;
}

export interface CanvasNudgeResult {
  command: Extract<
    CanvasCommandId,
    "nudge-left" | "nudge-right" | "nudge-up" | "nudge-down"
  >;
  delta: CanvasPoint;
}

/** A pointer expressed in browser client coordinates. */
export interface CanvasGesturePointer extends CanvasPoint, CanvasModifiers {}

export type CanvasGestureKind = "move" | "resize";
export type CanvasGesturePhase = "idle" | "pending" | "active";

export interface CanvasGestureBase<TObjectId = string> {
  readonly kind: CanvasGestureKind;
  readonly objectIds: readonly TObjectId[];
  /** Pointer location when the gesture began, in browser client coordinates. */
  readonly startPointer: CanvasGesturePointer;
  readonly pointer: CanvasGesturePointer;
  readonly clientDelta: CanvasPoint;
  readonly canvasDelta: CanvasPoint;
  /** Whether this gesture should create copies as part of its one final commit. */
  readonly duplicate: boolean;
}

export interface CanvasMoveGesture<
  TObjectId = string,
> extends CanvasGestureBase<TObjectId> {
  readonly kind: "move";
}

export interface CanvasResizeGesture<
  TObjectId = string,
> extends CanvasGestureBase<TObjectId> {
  readonly kind: "resize";
  readonly handle: CanvasResizeHandle;
  readonly startRect: CanvasRect;
  readonly rect: CanvasRect;
}

export type CanvasGesture<TObjectId = string> =
  | CanvasMoveGesture<TObjectId>
  | CanvasResizeGesture<TObjectId>;

export interface CanvasMoveGestureStart<TObjectId = string> {
  readonly kind: "move";
  readonly objectIds: readonly TObjectId[];
  readonly pointer: CanvasGesturePointer;
  readonly viewport: CanvasViewport;
  readonly canvas: CanvasSize;
}

export interface CanvasResizeGestureStart<TObjectId = string> {
  readonly kind: "resize";
  readonly objectIds: readonly TObjectId[];
  readonly pointer: CanvasGesturePointer;
  readonly viewport: CanvasViewport;
  readonly canvas: CanvasSize;
  readonly handle: CanvasResizeHandle;
  readonly rect: CanvasRect;
}

export type CanvasGestureStart<TObjectId = string> =
  | CanvasMoveGestureStart<TObjectId>
  | CanvasResizeGestureStart<TObjectId>;

/** Typed result returned by host preview, commit, and cancel callbacks. */
export type CanvasGestureAdapterResult =
  | { handled: true }
  | { handled: false; reason: "unsupported" | "unhandled" };

/**
 * Persistence-neutral callbacks for a single object gesture. Previews are
 * transient; `commit` is invoked at most once after an active gesture ends.
 */
export interface CanvasGestureAdapter<TObjectId = string> {
  preview?(gesture: CanvasGesture<TObjectId>): CanvasGestureAdapterResult;
  commit(gesture: CanvasGesture<TObjectId>): CanvasGestureAdapterResult;
  cancel?(gesture: CanvasGesture<TObjectId>): CanvasGestureAdapterResult;
}

export interface CanvasGestureControllerConfig<
  TObjectId = string,
> extends CanvasInteractionConfig {
  adapter: CanvasGestureAdapter<TObjectId>;
}

export interface CanvasGestureState<TObjectId = string> {
  readonly phase: CanvasGesturePhase;
  readonly gesture: CanvasGesture<TObjectId> | null;
}

export type CanvasGestureBeginResult<TObjectId = string> =
  | { accepted: true; state: CanvasGestureState<TObjectId> }
  | {
      accepted: false;
      reason: "unsupported" | "already-active" | "invalid-resize";
      state: CanvasGestureState<TObjectId>;
    };

export type CanvasGestureUpdateResult<TObjectId = string> =
  | { phase: "idle"; state: CanvasGestureState<TObjectId> }
  | { phase: "pending"; state: CanvasGestureState<TObjectId> }
  | {
      phase: "active";
      gesture: CanvasGesture<TObjectId>;
      preview: CanvasGestureAdapterResult | null;
      state: CanvasGestureState<TObjectId>;
    };

export type CanvasGestureEndResult<TObjectId = string> =
  | {
      committed: true;
      gesture: CanvasGesture<TObjectId>;
      result: CanvasGestureAdapterResult;
      state: CanvasGestureState<TObjectId>;
    }
  | {
      committed: false;
      reason: "idle" | "below-threshold" | "unsupported";
      state: CanvasGestureState<TObjectId>;
    };

export type CanvasGestureCancelResult<TObjectId = string> =
  | {
      cancelled: true;
      gesture: CanvasGesture<TObjectId>;
      result: CanvasGestureAdapterResult | null;
      state: CanvasGestureState<TObjectId>;
    }
  | { cancelled: false; reason: "idle"; state: CanvasGestureState<TObjectId> };

export const DEFAULT_CANVAS_SHORTCUTS: readonly CanvasShortcut[] = [
  { command: "select-all", key: "a", modifiers: ["primary"] },
  { command: "undo", key: "z", modifiers: ["primary"] },
  { command: "redo", key: "z", modifiers: ["primary", "shift"] },
  { command: "copy", key: "c", modifiers: ["primary"] },
  { command: "cut", key: "x", modifiers: ["primary"] },
  { command: "paste", key: "v", modifiers: ["primary"] },
  { command: "duplicate", key: "d", modifiers: ["primary"] },
  { command: "delete", key: "Backspace" },
  { command: "delete", key: "Delete" },
  {
    command: "arrange-front",
    key: "]",
    code: "BracketRight",
    modifiers: ["primary", "shift"],
  },
  {
    command: "arrange-back",
    key: "[",
    code: "BracketLeft",
    modifiers: ["primary", "shift"],
  },
];

function primaryModifierIsPressed(modifiers: CanvasModifiers): boolean {
  return Boolean(modifiers.metaKey || modifiers.ctrlKey);
}

function hasShortcutModifier(
  modifier: CanvasShortcutModifier,
  input: CanvasShortcutInput,
): boolean {
  switch (modifier) {
    case "primary":
      return primaryModifierIsPressed(input);
    case "shift":
      return Boolean(input.shiftKey);
    case "alt":
      return Boolean(input.altKey);
    case "ctrl":
      return Boolean(input.ctrlKey);
    case "meta":
      return Boolean(input.metaKey);
  }
}

function hasOnlyShortcutModifiers(
  shortcut: CanvasShortcut,
  input: CanvasShortcutInput,
): boolean {
  const modifiers = new Set(shortcut.modifiers ?? []);
  const expectedPrimary = modifiers.has("primary");
  const expectedCtrl = modifiers.has("ctrl") || expectedPrimary;
  const expectedMeta = modifiers.has("meta") || expectedPrimary;

  return (
    Boolean(input.shiftKey) === modifiers.has("shift") &&
    Boolean(input.altKey) === modifiers.has("alt") &&
    (!input.ctrlKey || expectedCtrl) &&
    (!input.metaKey || expectedMeta) &&
    (!expectedPrimary || primaryModifierIsPressed(input))
  );
}

/** Resolves click-to-edit without attaching event listeners. */
export function resolveCanvasTextActivation(
  input: CanvasTextActivationInput,
  policy: CanvasTextEditPolicy = {},
): CanvasTextActivationResult {
  if (!input.textEditable) return "select";
  const activation = policy.activation ?? "double-click";
  return input.clickCount >= (activation === "single-click" ? 1 : 2)
    ? "edit"
    : "select";
}

/**
 * Escape has one explicit owner: editing wins over any box-selection state.
 * The host applies this result before handing Escape to generic UI dismissal.
 */
export function resolveCanvasEscape<TObjectId>(
  input: CanvasEscapeInput<TObjectId>,
  policy: CanvasTextEditPolicy = {},
): CanvasEscapeResult<TObjectId> {
  const selectedObjectIds = input.selectedObjectIds ?? [];
  if (input.editingObjectId === null) {
    return { action: "none", editingObjectId: null, selectedObjectIds };
  }

  if ((policy.escapeBehavior ?? "select-object") === "cancel-edit") {
    return { action: "cancel-edit", editingObjectId: null, selectedObjectIds };
  }

  if ((policy.escapeBehavior ?? "select-object") === "clear-selection") {
    return {
      action: "clear-selection",
      editingObjectId: null,
      selectedObjectIds: [],
    };
  }

  return {
    action: "select-object",
    editingObjectId: null,
    selectedObjectIds: [input.editingObjectId],
  };
}

/** Converts a browser client point into unscaled canvas coordinates. */
export function clientPointToCanvasPoint(
  point: CanvasPoint,
  viewport: CanvasViewport,
  canvas: CanvasSize,
): CanvasPoint {
  if (viewport.width <= 0 || viewport.height <= 0) return { x: 0, y: 0 };
  return {
    x: ((point.x - viewport.left) / viewport.width) * canvas.width,
    y: ((point.y - viewport.top) / viewport.height) * canvas.height,
  };
}

/** Converts a client-space drag delta to the canvas's unscaled coordinate space. */
export function clientDeltaToCanvasDelta(
  delta: CanvasPoint,
  viewport: CanvasViewport,
  canvas: CanvasSize,
): CanvasPoint {
  if (viewport.width <= 0 || viewport.height <= 0) return { x: 0, y: 0 };
  return {
    x: (delta.x / viewport.width) * canvas.width,
    y: (delta.y / viewport.height) * canvas.height,
  };
}

/** Whether the client pointer crossed the intentional-drag threshold. */
export function hasCrossedCanvasDragThreshold(
  start: CanvasPoint,
  current: CanvasPoint,
  threshold = DEFAULT_CANVAS_DRAG_THRESHOLD,
): boolean {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  return dx * dx + dy * dy >= threshold * threshold;
}

/** Locks a drag to its dominant axis, used for Shift-drag. */
export function constrainCanvasDragDelta(
  delta: CanvasPoint,
  lockAxis = false,
): CanvasPoint {
  if (!lockAxis) return delta;
  return Math.abs(delta.x) >= Math.abs(delta.y)
    ? { x: delta.x, y: 0 }
    : { x: 0, y: delta.y };
}

/**
 * Resizes against the opposite edge. Shift preserves aspect ratio on corners;
 * midpoint handles stay single-axis so their fixed edge remains predictable.
 */
export function resizeCanvasRect(
  start: CanvasRect,
  input: CanvasResizeInput,
): CanvasRect {
  const fromWest =
    input.handle === "nw" || input.handle === "w" || input.handle === "sw";
  const fromEast =
    input.handle === "ne" || input.handle === "e" || input.handle === "se";
  const fromNorth =
    input.handle === "nw" || input.handle === "n" || input.handle === "ne";
  const fromSouth =
    input.handle === "sw" || input.handle === "s" || input.handle === "se";
  const resizesHorizontally = fromWest || fromEast;
  const resizesVertically = fromNorth || fromSouth;
  let width =
    start.width + (fromWest ? -input.delta.x : fromEast ? input.delta.x : 0);
  let height =
    start.height + (fromNorth ? -input.delta.y : fromSouth ? input.delta.y : 0);

  const minWidth = input.minWidth ?? DEFAULT_CANVAS_MIN_SIZE;
  const minHeight = input.minHeight ?? DEFAULT_CANVAS_MIN_SIZE;

  if (
    input.preserveAspectRatio &&
    resizesHorizontally &&
    resizesVertically &&
    start.width > 0 &&
    start.height > 0
  ) {
    const horizontalScale = width / start.width;
    const verticalScale = height / start.height;
    const scale =
      Math.abs(horizontalScale - 1) >= Math.abs(verticalScale - 1)
        ? horizontalScale
        : verticalScale;
    const minScale = Math.max(minWidth / start.width, minHeight / start.height);
    width = start.width * Math.max(minScale, scale);
    height = start.height * Math.max(minScale, scale);
  }

  width = Math.max(minWidth, width);
  height = Math.max(minHeight, height);
  return {
    x: fromWest ? start.x + start.width - width : start.x,
    y: fromNorth ? start.y + start.height - height : start.y,
    width,
    height,
  };
}

/** Whether this drag gesture should duplicate selected objects before moving. */
export function shouldDuplicateCanvasDrag(
  modifiers: CanvasModifiers,
  duplicateModifier: CanvasDuplicateModifier = "alt",
): boolean {
  switch (duplicateModifier) {
    case "alt":
      return Boolean(modifiers.altKey);
    case "meta":
      return Boolean(modifiers.metaKey);
    case "ctrl":
      return Boolean(modifiers.ctrlKey);
    case "none":
      return false;
  }
}

/** Resolves standard arrow-key movement, including Shift's accelerated nudge. */
export function resolveCanvasNudge(
  input: CanvasNudgeInput,
  policy: CanvasNudgePolicy = {},
): CanvasNudgeResult | null {
  const amount = input.shiftKey
    ? (policy.acceleratedAmount ?? DEFAULT_CANVAS_ACCELERATED_NUDGE)
    : (policy.amount ?? DEFAULT_CANVAS_NUDGE);
  switch (input.key) {
    case "ArrowLeft":
      return { command: "nudge-left", delta: { x: -amount, y: 0 } };
    case "ArrowRight":
      return { command: "nudge-right", delta: { x: amount, y: 0 } };
    case "ArrowUp":
      return { command: "nudge-up", delta: { x: 0, y: -amount } };
    case "ArrowDown":
      return { command: "nudge-down", delta: { x: 0, y: amount } };
    default:
      return null;
  }
}

/** Looks up a semantic command without referring to platform-specific events. */
export function resolveCanvasShortcut(
  input: CanvasShortcutInput,
  shortcuts: readonly CanvasShortcut[] = DEFAULT_CANVAS_SHORTCUTS,
): CanvasCommandId | null {
  const normalizedKey = input.key.toLowerCase();
  const shortcut = shortcuts.find(
    (candidate) =>
      (candidate.key.toLowerCase() === normalizedKey ||
        (candidate.code !== undefined && candidate.code === input.code)) &&
      (candidate.modifiers ?? []).every((modifier) =>
        hasShortcutModifier(modifier, input),
      ) &&
      hasOnlyShortcutModifiers(candidate, input),
  );
  return shortcut?.command ?? null;
}

/** Creates a reusable, immutable shortcut lookup for one editor policy. */
export function createCanvasShortcutRegistry(
  shortcuts: readonly CanvasShortcut[] = DEFAULT_CANVAS_SHORTCUTS,
): CanvasShortcutRegistry {
  return {
    shortcuts,
    resolve: (input) => resolveCanvasShortcut(input, shortcuts),
  };
}

/**
 * Creates an app-configured pure interaction core. `dispatch` is optional so
 * hosts can either use the helpers directly or receive semantic commands via
 * their adapter without the Toolkit owning any state.
 */
export function createCanvasInteractionCore<TObjectId = string>(
  config: CanvasInteractionConfig = {},
  adapter?: CanvasInteractionAdapter<TObjectId>,
) {
  const textEditing = config.textEditing ?? {};
  const capabilities: CanvasInteractionCapabilities = {
    ...DEFAULT_CANVAS_INTERACTION_CAPABILITIES,
    ...adapter?.capabilities,
    ...config.capabilities,
  };
  const drag = config.drag ?? {};
  const nudge = config.nudge ?? {};
  const shortcuts = createCanvasShortcutRegistry(config.shortcuts);

  const supportsCommand = (command: CanvasCommand<TObjectId>): boolean => {
    switch (command.id) {
      case "copy":
      case "cut":
      case "paste":
        return capabilities.clipboard;
      case "duplicate":
        return capabilities.duplicate;
      case "delete":
        return capabilities.delete;
      case "nudge":
      case "nudge-left":
      case "nudge-right":
      case "nudge-up":
      case "nudge-down":
        return capabilities.nudge;
      case "arrange-front":
      case "arrange-back":
      case "bring-forward":
      case "bring-to-front":
      case "send-backward":
      case "send-to-back":
        return capabilities.arrange;
      case "align-left":
      case "align-center":
      case "align-right":
      case "align-top":
      case "align-middle":
      case "align-bottom":
        return capabilities.alignment;
      case "distribute-horizontal":
      case "distribute-vertical":
        return capabilities.distribution;
      case "group":
      case "ungroup":
        return capabilities.grouping;
      case "frame-selection":
        return capabilities.selection;
      default:
        return true;
    }
  };

  return {
    capabilities,
    textActivation: (input: CanvasTextActivationInput) =>
      capabilities.textEditing
        ? resolveCanvasTextActivation(input, textEditing)
        : "select",
    escape: (input: CanvasEscapeInput<TObjectId>) =>
      resolveCanvasEscape(input, textEditing),
    clientPointToCanvas: (
      point: CanvasPoint,
      viewport: CanvasViewport,
      canvas: CanvasSize,
    ) => clientPointToCanvasPoint(point, viewport, canvas),
    clientDeltaToCanvas: (
      delta: CanvasPoint,
      viewport: CanvasViewport,
      canvas: CanvasSize,
    ) => clientDeltaToCanvasDelta(delta, viewport, canvas),
    hasCrossedDragThreshold: (start: CanvasPoint, current: CanvasPoint) =>
      hasCrossedCanvasDragThreshold(start, current, drag.threshold),
    constrainDrag: (delta: CanvasPoint, modifiers: CanvasModifiers = {}) =>
      constrainCanvasDragDelta(delta, Boolean(modifiers.shiftKey)),
    resize: (start: CanvasRect, input: CanvasResizeInput) =>
      resizeCanvasRect(start, {
        ...input,
        minWidth: input.minWidth ?? config.minSize,
        minHeight: input.minHeight ?? config.minSize,
      }),
    shouldDuplicateDrag: (modifiers: CanvasModifiers) =>
      capabilities.duplicate &&
      shouldDuplicateCanvasDrag(modifiers, drag.duplicateModifier),
    nudge: (input: CanvasNudgeInput) =>
      capabilities.nudge ? resolveCanvasNudge(input, nudge) : null,
    shortcut: (input: CanvasShortcutInput) => shortcuts.resolve(input),
    dispatch: (command: CanvasCommand<TObjectId>) => {
      if (!adapter) return { handled: false, reason: "no-adapter" } as const;
      if (!supportsCommand(command)) {
        return { handled: false, reason: "unsupported" } as const;
      }
      return adapter.dispatch(command);
    },
  };
}

/**
 * Creates a small state machine for one pointer gesture at a time. It keeps
 * browser coordinates at its boundary, while every emitted preview and commit
 * is in stable canvas coordinates. Hosts own rendering and persistence.
 */
export function createCanvasGestureController<TObjectId = string>(
  config: CanvasGestureControllerConfig<TObjectId>,
) {
  const core = createCanvasInteractionCore(config);
  let start: CanvasGestureStart<TObjectId> | null = null;
  let activeGesture: CanvasGesture<TObjectId> | null = null;

  const state = (): CanvasGestureState<TObjectId> => ({
    phase: activeGesture ? "active" : start ? "pending" : "idle",
    gesture: activeGesture,
  });

  const canStart = (kind: CanvasGestureKind) =>
    kind === "move" ? core.capabilities.move : core.capabilities.resize;

  const buildGesture = (
    gestureStart: CanvasGestureStart<TObjectId>,
    pointer: CanvasGesturePointer,
  ): CanvasGesture<TObjectId> => {
    const clientDelta = {
      x: pointer.x - gestureStart.pointer.x,
      y: pointer.y - gestureStart.pointer.y,
    };
    const convertedDelta = clientDeltaToCanvasDelta(
      clientDelta,
      gestureStart.viewport,
      gestureStart.canvas,
    );
    const duplicate =
      gestureStart.kind === "move" && core.capabilities.duplicate
        ? core.shouldDuplicateDrag(gestureStart.pointer) &&
          core.shouldDuplicateDrag(pointer)
        : false;

    if (gestureStart.kind === "move") {
      return {
        kind: "move",
        objectIds: gestureStart.objectIds,
        startPointer: gestureStart.pointer,
        pointer,
        clientDelta,
        canvasDelta: core.constrainDrag(convertedDelta, pointer),
        duplicate,
      };
    }

    return {
      kind: "resize",
      objectIds: gestureStart.objectIds,
      startPointer: gestureStart.pointer,
      pointer,
      clientDelta,
      canvasDelta: convertedDelta,
      duplicate: false,
      handle: gestureStart.handle,
      startRect: gestureStart.rect,
      rect: core.resize(gestureStart.rect, {
        handle: gestureStart.handle,
        delta: convertedDelta,
        preserveAspectRatio: Boolean(pointer.shiftKey),
      }),
    };
  };

  const preview = (
    gesture: CanvasGesture<TObjectId>,
  ): CanvasGestureUpdateResult<TObjectId> => {
    activeGesture = gesture;
    return {
      phase: "active",
      gesture,
      preview: config.adapter.preview?.(gesture) ?? null,
      state: state(),
    };
  };

  const update = (
    pointer: CanvasGesturePointer,
  ): CanvasGestureUpdateResult<TObjectId> => {
    if (!start) return { phase: "idle", state: state() };
    if (!activeGesture) {
      const crossedThreshold = core.hasCrossedDragThreshold(
        start.pointer,
        pointer,
      );
      if (!crossedThreshold) return { phase: "pending", state: state() };
    }
    return preview(buildGesture(start, pointer));
  };

  const hasSamePointerState = (
    first: CanvasGesturePointer,
    second: CanvasGesturePointer,
  ) =>
    first.x === second.x &&
    first.y === second.y &&
    Boolean(first.altKey) === Boolean(second.altKey) &&
    Boolean(first.ctrlKey) === Boolean(second.ctrlKey) &&
    Boolean(first.metaKey) === Boolean(second.metaKey) &&
    Boolean(first.shiftKey) === Boolean(second.shiftKey);

  return {
    capabilities: core.capabilities,
    getState: state,
    pointerDown: (
      gestureStart: CanvasGestureStart<TObjectId>,
    ): CanvasGestureBeginResult<TObjectId> => {
      if (start) {
        return { accepted: false, reason: "already-active", state: state() };
      }
      if (!canStart(gestureStart.kind)) {
        return { accepted: false, reason: "unsupported", state: state() };
      }
      if (
        gestureStart.kind === "resize" &&
        (gestureStart.rect.width <= 0 || gestureStart.rect.height <= 0)
      ) {
        return { accepted: false, reason: "invalid-resize", state: state() };
      }
      start = gestureStart;
      return { accepted: true, state: state() };
    },
    pointerMove: update,
    pointerUp: (
      pointer: CanvasGesturePointer,
    ): CanvasGestureEndResult<TObjectId> => {
      const shouldUpdate =
        activeGesture === null ||
        !hasSamePointerState(activeGesture.pointer, pointer);
      const beforeEnd = shouldUpdate
        ? update(pointer)
        : ({ phase: "active", state: state() } as const);
      const gesture = activeGesture;
      start = null;
      activeGesture = null;
      if (!gesture) {
        return {
          committed: false,
          reason: beforeEnd.phase === "idle" ? "idle" : "below-threshold",
          state: state(),
        };
      }
      return {
        committed: true,
        gesture,
        result: config.adapter.commit(gesture),
        state: state(),
      };
    },
    cancel: (): CanvasGestureCancelResult<TObjectId> => {
      const gesture = activeGesture;
      start = null;
      activeGesture = null;
      if (!gesture) return { cancelled: false, reason: "idle", state: state() };
      return {
        cancelled: true,
        gesture,
        result: config.adapter.cancel?.(gesture) ?? null,
        state: state(),
      };
    },
  };
}
