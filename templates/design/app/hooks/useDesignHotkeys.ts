import { useEffect, useLayoutEffect, useRef } from "react";

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export type DesignHotkeyTool =
  | "move"
  | "frame"
  | "rectangle"
  | "line"
  | "arrow"
  | "ellipse"
  | "text"
  | "pen"
  | "hand"
  | "comment"
  | "draw"
  | "scale";

export type DesignHotkeyDirection = "up" | "right" | "down" | "left";

export interface DesignHotkeyDetails {
  event: KeyboardEvent;
  key: string;
  primary: boolean;
  shift: boolean;
  alt: boolean;
  repeat: boolean;
}

export interface DesignHotkeyNudgeDetails extends DesignHotkeyDetails {
  direction: DesignHotkeyDirection;
  largeStep: boolean;
}

export interface DesignHotkeyTabDetails extends DesignHotkeyDetails {
  backwards: boolean;
}

export interface DesignHotkeyOpacityDetails extends DesignHotkeyDetails {
  /** 1-100. Digit "1".."9" (no modifier) map to 10-90; "0" maps to 100. */
  opacity: number;
}

export type DesignHotkeyAlignEdge =
  | "left"
  | "center-h"
  | "right"
  | "top"
  | "center-v"
  | "bottom";

export interface DesignHotkeyAlignDetails extends DesignHotkeyDetails {
  edge: DesignHotkeyAlignEdge;
}

export type DesignHotkeyDistributeAxis = "horizontal" | "vertical";

export interface DesignHotkeyDistributeDetails extends DesignHotkeyDetails {
  axis: DesignHotkeyDistributeAxis;
}

export type DesignHotkeyTarget = Window | Document | HTMLElement;
export type DesignHotkeyHandler = (details: DesignHotkeyDetails) => void;
export type DesignHotkeyToolHandler = (
  tool: DesignHotkeyTool,
  details: DesignHotkeyDetails,
) => void;
export type DesignHotkeyNudgeHandler = (
  details: DesignHotkeyNudgeDetails,
) => void;
export type DesignHotkeyTabHandler = (details: DesignHotkeyTabDetails) => void;
export type DesignHotkeyOpacityHandler = (
  details: DesignHotkeyOpacityDetails,
) => void;
export type DesignHotkeyAlignHandler = (
  details: DesignHotkeyAlignDetails,
) => void;
export type DesignHotkeyDistributeHandler = (
  details: DesignHotkeyDistributeDetails,
) => void;

export interface UseDesignHotkeysProps {
  enabled?: boolean;
  capture?: boolean;
  target?: DesignHotkeyTarget | null;
  preventDefault?: boolean;
  ignoreEditableTargets?: boolean;
  shouldHandleEvent?: (event: KeyboardEvent) => boolean;
  onToolChange?: DesignHotkeyToolHandler;
  onMoveTool?: DesignHotkeyHandler;
  onFrameTool?: DesignHotkeyHandler;
  onRectangleTool?: DesignHotkeyHandler;
  onLineTool?: DesignHotkeyHandler;
  onArrowTool?: DesignHotkeyHandler;
  onEllipseTool?: DesignHotkeyHandler;
  onTextTool?: DesignHotkeyHandler;
  onPenTool?: DesignHotkeyHandler;
  onHandTool?: DesignHotkeyHandler;
  onCommentTool?: DesignHotkeyHandler;
  onDrawTool?: DesignHotkeyHandler;
  onScaleTool?: DesignHotkeyHandler;
  onCopy?: DesignHotkeyHandler;
  /** Figma's Shift+Cmd/Ctrl+C — render the current selection and write it to
   *  the system clipboard as a real image/png ClipboardItem. */
  onCopyAsPng?: DesignHotkeyHandler;
  onCut?: DesignHotkeyHandler;
  onPaste?: DesignHotkeyHandler;
  onPasteOver?: DesignHotkeyHandler;
  onCopyProps?: DesignHotkeyHandler;
  onPasteProps?: DesignHotkeyHandler;
  onDuplicate?: DesignHotkeyHandler;
  onDelete?: DesignHotkeyHandler;
  onRename?: DesignHotkeyHandler;
  /** Figma's Cmd/Ctrl+F — open and focus the layer search surface. */
  onFind?: DesignHotkeyHandler;
  /** Figma's Option/Alt+1 — open the File/Layers navigation panel. */
  onShowLayersPanel?: DesignHotkeyHandler;
  /** Figma's Option/Alt+2 — open the Assets navigation panel. */
  onShowAssetsPanel?: DesignHotkeyHandler;
  onSelectAll?: DesignHotkeyHandler;
  onGroup?: DesignHotkeyHandler;
  onUngroup?: DesignHotkeyHandler;
  /** Figma's Cmd+Alt+G — "Frame selection": wrap the selection in a frame
   *  container (distinct from onGroup's plain-group wrapper). */
  onFrameSelection?: DesignHotkeyHandler;
  onUndo?: DesignHotkeyHandler;
  onRedo?: DesignHotkeyHandler;
  onBringForward?: DesignHotkeyHandler;
  onBringToFront?: DesignHotkeyHandler;
  onSendBackward?: DesignHotkeyHandler;
  onSendToBack?: DesignHotkeyHandler;
  onEscape?: DesignHotkeyHandler;
  onEnter?: DesignHotkeyHandler;
  onSelectParent?: DesignHotkeyHandler;
  onTab?: DesignHotkeyTabHandler;
  onNextFrame?: DesignHotkeyHandler;
  onPreviousFrame?: DesignHotkeyHandler;
  onNudge?: DesignHotkeyNudgeHandler;
  onZoomIn?: DesignHotkeyHandler;
  onZoomOut?: DesignHotkeyHandler;
  onZoomReset?: DesignHotkeyHandler;
  onZoomToFit?: DesignHotkeyHandler;
  onZoomToSelection?: DesignHotkeyHandler;
  /** Figma's Cmd+Alt+K — create component from the current selection. */
  onCreateComponent?: DesignHotkeyHandler;
  /**
   * Figma's plain digit 1-9 / 0 — set selection opacity (10-90%, 0 = 100%).
   * Only fires when a layer is selected (caller decides via presence of the
   * handler / its own guard) and the event isn't a modifier combo or an
   * editable-target keystroke (already filtered by ignoreEditableTargets).
   */
  onOpacityChange?: DesignHotkeyOpacityHandler;
  /** Figma's Cmd+Shift+H — toggle hide/show for the current selection (all
   *  selected layers/screens). */
  onToggleHidden?: DesignHotkeyHandler;
  /** Figma's Cmd+Shift+L — toggle lock/unlock for the current selection. */
  onToggleLocked?: DesignHotkeyHandler;
  /** Figma's Shift+H — flip the current selection horizontally. */
  onFlipHorizontal?: DesignHotkeyHandler;
  /** Figma's Shift+V — flip the current selection vertically. */
  onFlipVertical?: DesignHotkeyHandler;
  /** Figma's Shift+X — swap the current selection's fill and stroke. */
  onSwapFillStroke?: DesignHotkeyHandler;
  /** Figma's Shift+Cmd+R — paste to replace the current selection with the
   *  internal canvas clipboard's contents. */
  onPasteToReplace?: DesignHotkeyHandler;
  /**
   * Figma's Control+C on Apple platforms — eyedropper: sample a color from
   * anywhere on screen and apply it to the current selection. A one-shot
   * action, not a persistent tool.
   */
  onEyedropper?: DesignHotkeyHandler;
  /**
   * Figma's Alt+A/D/W/S/H/V — align the current selection to left/right/top/
   * bottom/center-h/center-v. Alt-only (no cmd/shift); moves the selection
   * itself, matching the EditPanel Alignment row's `onAlignSelection`
   * contract (see PositionLayoutProperties in EditPanel.tsx).
   */
  onAlignSelection?: DesignHotkeyAlignHandler;
  /**
   * Figma's Ctrl+Alt+H / Ctrl+Alt+V — distribute the selection evenly along
   * the horizontal/vertical axis (3+ objects; first/last stay put).
   */
  onDistributeSelection?: DesignHotkeyDistributeHandler;
  /** Figma's Ctrl+Alt+T (literal Control on every platform, not Cmd) — Tidy
   *  up: arrange the selection into a compact grid with uniform gaps. */
  onTidyUp?: DesignHotkeyHandler;
  /**
   * Figma's Shift+A — Add auto layout. Shift-only so it never shadows the
   * plain "a" frame-tool shortcut (TOOL_SHORTCUTS only fires with no
   * modifiers held) or SHIFT_TOOL_SHORTCUTS (which has no "a" entry).
   */
  onAddAutoLayout?: DesignHotkeyHandler;
  /** Figma's Cmd+\ — toggle Show/Hide UI (left rail, right panel, bottom
   *  toolbar chrome). */
  onToggleUi?: DesignHotkeyHandler;
  /** Figma's Shift+C — toggle Show/Hide comments (comment pins). */
  onToggleComments?: DesignHotkeyHandler;
}

const TOOL_SHORTCUTS: Record<
  string,
  { tool: DesignHotkeyTool; handler: keyof UseDesignHotkeysProps }
> = {
  v: { tool: "move", handler: "onMoveTool" },
  f: { tool: "frame", handler: "onFrameTool" },
  r: { tool: "rectangle", handler: "onRectangleTool" },
  o: { tool: "ellipse", handler: "onEllipseTool" },
  l: { tool: "line", handler: "onLineTool" },
  t: { tool: "text", handler: "onTextTool" },
  p: { tool: "pen", handler: "onPenTool" },
  h: { tool: "hand", handler: "onHandTool" },
  k: { tool: "scale", handler: "onScaleTool" },
  c: { tool: "comment", handler: "onCommentTool" },
  y: { tool: "draw", handler: "onDrawTool" },
};

// H1: shift+key variants of a base tool shortcut (Figma muscle-memory), e.g.
// Shift+L selects the arrow tool while plain L selects the line tool. Keyed
// by the same lowercased key as TOOL_SHORTCUTS; only consulted when
// event.shiftKey is true so it never shadows the unshifted binding.
const SHIFT_TOOL_SHORTCUTS: Record<
  string,
  { tool: DesignHotkeyTool; handler: keyof UseDesignHotkeysProps }
> = {
  l: { tool: "arrow", handler: "onArrowTool" },
};

const ARROW_DIRECTIONS: Record<string, DesignHotkeyDirection> = {
  ArrowUp: "up",
  ArrowRight: "right",
  ArrowDown: "down",
  ArrowLeft: "left",
};

export function isDesignHotkeyEditableTarget(target: EventTarget | null) {
  if (!target || typeof Element === "undefined") return false;
  if (!(target instanceof Element)) return false;

  const editable = target.closest(
    [
      "input",
      "textarea",
      "select",
      "[contenteditable]",
      '[role="textbox"]',
      '[data-hotkeys-scope="text"]',
    ].join(","),
  );

  if (!editable) return false;
  if (editable instanceof HTMLElement && editable.isContentEditable) {
    return true;
  }
  if (
    editable instanceof HTMLElement &&
    editable.hasAttribute("data-hotkeys-scope")
  ) {
    return true;
  }
  if (
    editable instanceof HTMLElement &&
    editable.getAttribute("role") === "textbox"
  ) {
    return true;
  }
  const tagName = editable.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

function isFocusableChromeTarget(target: EventTarget | null) {
  if (!target || typeof Element === "undefined") return false;
  if (!(target instanceof Element)) return false;
  if (target === document.body || target === document.documentElement) {
    return false;
  }
  return Boolean(
    target.closest(
      [
        "a[href]",
        "button",
        "summary",
        "input",
        "textarea",
        "select",
        "[contenteditable]",
        '[role="button"]',
        '[role="menuitem"]',
        '[role="option"]',
        '[role="tab"]',
        '[tabindex]:not([tabindex="-1"])',
      ].join(","),
    ),
  );
}

export function useDesignHotkeys(props: UseDesignHotkeysProps) {
  const propsRef = useRef(props);

  useIsomorphicLayoutEffect(() => {
    propsRef.current = props;
  });

  useEffect(() => {
    const eventTarget =
      props.target ??
      (typeof window === "undefined" ? null : (window as DesignHotkeyTarget));
    if (!eventTarget || props.enabled === false) return;

    const handleKeyDown = (event: Event) => {
      if (!(event instanceof KeyboardEvent)) return;
      const current = propsRef.current;
      if (current.enabled === false) return;
      if (event.defaultPrevented || event.isComposing) return;
      if (current.shouldHandleEvent && !current.shouldHandleEvent(event))
        return;
      if (
        current.ignoreEditableTargets !== false &&
        isDesignHotkeyEditableTarget(event.target)
      ) {
        return;
      }

      handleDesignHotkey(event, current);
    };

    eventTarget.addEventListener("keydown", handleKeyDown, {
      capture: props.capture,
    });
    return () => {
      eventTarget.removeEventListener("keydown", handleKeyDown, {
        capture: props.capture,
      });
    };
  }, [props.capture, props.enabled, props.target]);
}

function handleDesignHotkey(
  event: KeyboardEvent,
  props: UseDesignHotkeysProps,
) {
  const key = normalizedKey(event);
  const primary = event.metaKey || event.ctrlKey;
  const details: DesignHotkeyDetails = {
    event,
    key,
    primary,
    shift: event.shiftKey,
    alt: event.altKey,
    repeat: event.repeat,
  };

  const prevent = () => {
    if (props.preventDefault !== false) event.preventDefault();
  };

  const run = (handler: DesignHotkeyHandler | undefined) => {
    if (!handler) return false;
    prevent();
    handler(details);
    return true;
  };

  const runTool = (
    tool: DesignHotkeyTool,
    handler: DesignHotkeyHandler | undefined,
  ) => {
    if (!handler && !props.onToolChange) return false;
    prevent();
    handler?.(details);
    props.onToolChange?.(tool, details);
    return true;
  };

  const runNudge = (direction: DesignHotkeyDirection) => {
    if (!props.onNudge) return false;
    prevent();
    props.onNudge({
      ...details,
      direction,
      largeStep: event.shiftKey,
    });
    return true;
  };

  const runAlign = (edge: DesignHotkeyAlignEdge) => {
    if (!props.onAlignSelection) return false;
    prevent();
    props.onAlignSelection({ ...details, edge });
    return true;
  };

  const runDistribute = (axis: DesignHotkeyDistributeAxis) => {
    if (!props.onDistributeSelection) return false;
    prevent();
    props.onDistributeSelection({ ...details, axis });
    return true;
  };

  if (!primary && !event.altKey && event.shiftKey) {
    // H1: shift+key variant (e.g. Shift+L → arrow tool) takes priority over
    // the base binding for the same key while shift is held.
    const shiftToolShortcut = SHIFT_TOOL_SHORTCUTS[key];
    if (shiftToolShortcut) {
      return runTool(
        shiftToolShortcut.tool,
        props[shiftToolShortcut.handler] as DesignHotkeyHandler | undefined,
      );
    }
  }

  if (!primary && !event.altKey && !event.shiftKey) {
    const toolShortcut = TOOL_SHORTCUTS[key];
    if (toolShortcut) {
      return runTool(
        toolShortcut.tool,
        props[toolShortcut.handler] as DesignHotkeyHandler | undefined,
      );
    }
  }

  if (event.key in ARROW_DIRECTIONS && !primary && !event.altKey) {
    return runNudge(ARROW_DIRECTIONS[event.key]);
  }

  if (event.key === "Escape") return run(props.onEscape);
  if (event.key === "Enter") return run(props.onEnter);
  if (!primary && !event.altKey && !event.shiftKey && key === "\\") {
    return run(props.onSelectParent);
  }
  if (
    event.key === "Tab" &&
    props.onTab &&
    // Ignore synthetic (non-trusted) Tab events dispatched by handleIframeHotkey
    // unless they carry the iframe-hotkey marker. This keeps inspector field
    // tabbing native while allowing real iframe canvas Tab presses to traverse
    // layer siblings.
    (event.isTrusted !== false ||
      (event as KeyboardEvent & { __agentNativeIframeHotkey?: boolean })
        .__agentNativeIframeHotkey === true) &&
    !isFocusableChromeTarget(event.target) &&
    !isDesignHotkeyEditableTarget(document.activeElement)
  ) {
    prevent();
    props.onTab({ ...details, backwards: event.shiftKey });
    return true;
  }
  if ((event.key === "Delete" || event.key === "Backspace") && !primary) {
    return run(props.onDelete);
  }

  // Current Figma: Cmd+Backspace ungroups. This intentionally differs from
  // the historical Shift+Cmd+G binding and must be checked after plain
  // Backspace deletion has been ruled out.
  if (primary && !event.altKey && !event.shiftKey && key === "Backspace") {
    return run(props.onUngroup);
  }

  if (primary && key === "z") {
    return event.shiftKey ? run(props.onRedo) : run(props.onUndo);
  }
  if (primary && key === "y") return run(props.onRedo);
  // Figma Find uses the operating system's primary modifier, rather than
  // treating literal Control and Command as interchangeable on macOS. Keep
  // Ctrl+F available for platform/browser behavior on Apple devices while
  // routing Cmd+F there and Ctrl+F everywhere else.
  if (
    isPlatformPrimaryModifier(event) &&
    !event.altKey &&
    !event.shiftKey &&
    key === "f"
  ) {
    return run(props.onFind);
  }
  if (primary && !event.altKey && !event.shiftKey && key === "a") {
    return run(props.onSelectAll);
  }
  if (primary && key === "x") return run(props.onCut);

  // Current Figma: Ctrl+Alt+H / Ctrl+Alt+V — distribute evenly. These use
  // literal Control even on macOS, so resolve them before the primary+V
  // Paste properties family can claim Ctrl+Alt+V.
  if (event.ctrlKey && event.altKey && !event.metaKey && !event.shiftKey) {
    if (key === "h") return runDistribute("horizontal");
    if (key === "v") return runDistribute("vertical");
  }

  // On macOS Figma reserves literal Control+C for Pick color while Cmd+C
  // remains Copy. Keep Ctrl+C as Copy on non-Apple platforms, where Ctrl is
  // the platform's primary modifier and Figma presents platform-specific
  // shortcuts.
  if (
    isApplePlatform() &&
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    key === "c"
  ) {
    return run(props.onEyedropper);
  }
  if (primary && key === "c") {
    if (event.altKey) return run(props.onCopyProps);
    if (event.shiftKey) return run(props.onCopyAsPng);
    return run(props.onCopy);
  }
  if (primary && key === "v") {
    if (event.altKey) return run(props.onPasteProps);
    if (event.shiftKey) return run(props.onPasteOver);
    return run(props.onPaste);
  }
  if (primary && key === "d") return run(props.onDuplicate);
  // Figma's Shift+Cmd+R — "Paste to replace" — must be checked BEFORE plain
  // Cmd+R (rename) so shift wins; onPasteToReplace absent falls through to
  // rename so existing behavior is unaffected until the handler is wired.
  if (primary && event.shiftKey && key === "r") {
    return run(props.onPasteToReplace);
  }
  if (primary && key === "r") return run(props.onRename);
  // Cmd+Shift+H/L (hide/lock the current selection) must take precedence over
  // the unmodified/shift-only h/l transform and alignment families.
  if (primary && event.shiftKey && key === "h") {
    return run(props.onToggleHidden);
  }
  if (primary && event.shiftKey && key === "l") {
    return run(props.onToggleLocked);
  }
  if (primary && key === "g") {
    // Figma: ⌥⌘G is "Frame selection". Current Figma ungroups with
    // Cmd+Backspace, so the historical Shift+Cmd+G binding is deliberately
    // left unhandled.
    if (event.altKey) return run(props.onFrameSelection);
    if (event.shiftKey) return false;
    return run(props.onGroup);
  }

  if (primary && (key === "=" || key === "+")) return run(props.onZoomIn);
  if (primary && key === "-") return run(props.onZoomOut);
  if (primary && key === "0") return run(props.onZoomReset);

  // Figma: plain +/= and - (no modifiers) also zoom in/out.
  if (!primary && !event.altKey && !event.shiftKey) {
    if (key === "=" || key === "+") return run(props.onZoomIn);
    if (key === "-") return run(props.onZoomOut);
  }

  // Figma: Shift+= ("+" on a US keyboard, since "+" is the shifted "=") also
  // zooms in. Checked separately from the plain-modifier branch above (which
  // requires !shiftKey) so this doesn't need to disturb that branch's other
  // no-modifier-only guarantees; key === "+" already implies shift produced
  // it on layouts where "+" isn't its own physical key, but this also covers
  // event.code === "Equal" with shiftKey true for layouts that report key as
  // "=" while shifted.
  if (!primary && !event.altKey && event.shiftKey) {
    if (key === "+" || (key === "=" && event.code === "Equal")) {
      return run(props.onZoomIn);
    }
  }

  // H2: Cmd+Alt+K — create component from the current selection.
  if (primary && event.altKey && key === "k") {
    return run(props.onCreateComponent);
  }

  const digit = digitFromEvent(event);
  // Figma navigation tabs use literal Option/Alt, on both platforms. Resolve
  // these before digit opacity so the physical Digit1/Digit2 keys never leak
  // into selection styling when Alt is held (including Option-composed keys
  // such as ¡ on macOS).
  if (!primary && event.altKey && !event.shiftKey) {
    if (digit === "1") return run(props.onShowLayersPanel);
    if (digit === "2") return run(props.onShowAssetsPanel);
  }
  if (event.shiftKey && !primary && digit === "1") {
    return run(props.onZoomToFit);
  }
  if (event.shiftKey && !primary && digit === "2") {
    return run(props.onZoomToSelection);
  }
  // H2: plain digit 1-9/0 (no modifier) — set selection opacity. Figma maps
  // 1-9 to 10%-90% and 0 to 100%. Only handled when nothing else claimed the
  // digit (e.g. Shift+1/Shift+2 zoom above) and no modifier is held; the
  // caller supplies onOpacityChange only when a layer is selected and canvas
  // has focus, so an absent handler naturally no-ops here.
  if (
    !primary &&
    !event.altKey &&
    !event.shiftKey &&
    digit &&
    props.onOpacityChange
  ) {
    const opacity = digit === "0" ? 100 : Number(digit) * 10;
    prevent();
    props.onOpacityChange({ ...details, opacity });
    return true;
  }

  // Ground-truth Figma: plain ]/[ (no modifiers) are Bring to front / Send
  // to back — the "big jump" commands. Cmd+]/Cmd+[ are Bring forward / Send
  // backward (single-step reorder). Alt+Cmd+]/Alt+Cmd+[ are silent aliases
  // of the plain front/back commands (kept for muscle memory / older
  // bindings), NOT of forward/backward.
  if (primary && key === "]") {
    return event.altKey ? run(props.onBringToFront) : run(props.onBringForward);
  }
  if (primary && key === "[") {
    return event.altKey ? run(props.onSendToBack) : run(props.onSendBackward);
  }
  if (!primary && !event.altKey && !event.shiftKey && key === "]") {
    return run(props.onBringToFront);
  }
  if (!primary && !event.altKey && !event.shiftKey && key === "[") {
    return run(props.onSendToBack);
  }

  // Current Figma reserves N / Shift+N for moving to the next / previous
  // frame. Tab remains layer-sibling traversal and is handled above.
  if (!primary && !event.altKey && key === "n") {
    return event.shiftKey ? run(props.onPreviousFrame) : run(props.onNextFrame);
  }

  // H3: Shift+H / Shift+V — flip selection horizontal/vertical. Checked
  // after the primary+shift h/l (hide/lock) branch above so Cmd+Shift+H
  // still wins; h/v aren't in SHIFT_TOOL_SHORTCUTS so there's no real
  // shortcut collision here either.
  if (!primary && !event.altKey && event.shiftKey && key === "h") {
    return run(props.onFlipHorizontal);
  }
  if (!primary && !event.altKey && event.shiftKey && key === "v") {
    return run(props.onFlipVertical);
  }

  // Figma: Shift+X — swap fill and stroke. Cmd+X (cut) is unaffected since
  // this only fires when shift is held and no primary modifier is present.
  if (!primary && !event.altKey && event.shiftKey && key === "x") {
    return run(props.onSwapFillStroke);
  }

  // Figma: Alt+A/D/W/S/H/V — align the selection to left/right/top/bottom/
  // center-h/center-v. Alt-only (no cmd, no shift — shift+h/v are the
  // distribute bindings just above, shift+a is Add auto layout below).
  if (!primary && event.altKey && !event.shiftKey) {
    if (key === "a") return runAlign("left");
    if (key === "d") return runAlign("right");
    if (key === "w") return runAlign("top");
    if (key === "s") return runAlign("bottom");
    if (key === "h") return runAlign("center-h");
    if (key === "v") return runAlign("center-v");
  }

  // Figma: Ctrl+Alt+T — Tidy up. A rare Figma shortcut that stays literal
  // Control on every platform (never remapped to Cmd on Mac), so this checks
  // event.ctrlKey directly instead of the combined `primary` flag.
  if (
    event.ctrlKey &&
    event.altKey &&
    !event.metaKey &&
    !event.shiftKey &&
    key === "t"
  ) {
    return run(props.onTidyUp);
  }

  // Figma: Shift+A — Add auto layout. Plain A is intentionally unbound in
  // current Figma, so this shift-only command cannot shadow another tool.
  if (!primary && !event.altKey && event.shiftKey && key === "a") {
    return run(props.onAddAutoLayout);
  }

  // Figma: Cmd+\ — Show/Hide UI (empty-canvas context-menu item).
  if (primary && key === "\\") {
    return run(props.onToggleUi);
  }

  // Figma: Shift+C — Show/Hide comments. Plain "c" (no modifiers) is the
  // comment-pin TOOL_SHORTCUTS entry, so shift+c can't shadow it.
  if (!primary && !event.altKey && event.shiftKey && key === "c") {
    return run(props.onToggleComments);
  }

  return false;
}

// Physical-position (event.code) letter/punctuation lookup used ONLY when
// event.altKey is true. On real macOS keyboards, Option+letter produces a
// composed/dead-key character in event.key (Option+A -> "å", Option+H ->
// "˙", Option+] tends to be unaffected but other punctuation isn't), so
// every alt-held combo must match on the physical key position instead of
// the printed character. This mirrors Figma's own behavior: its alt-letter
// shortcuts (align, distribute, frame-selection, create-component, z-order
// aliases, tidy up) fire from the QWERTY physical position regardless of
// what character Option composes on the active input layout.
const ALT_CODE_KEYS: Record<string, string> = {
  KeyA: "a",
  KeyB: "b",
  KeyC: "c",
  KeyD: "d",
  KeyE: "e",
  KeyF: "f",
  KeyG: "g",
  KeyH: "h",
  KeyI: "i",
  KeyJ: "j",
  KeyK: "k",
  KeyL: "l",
  KeyM: "m",
  KeyN: "n",
  KeyO: "o",
  KeyP: "p",
  KeyQ: "q",
  KeyR: "r",
  KeyS: "s",
  KeyT: "t",
  KeyU: "u",
  KeyV: "v",
  KeyW: "w",
  KeyX: "x",
  KeyY: "y",
  KeyZ: "z",
  BracketRight: "]",
  BracketLeft: "[",
};

function isApplePlatform() {
  if (typeof navigator === "undefined") return false;
  const userAgentDataPlatform = (
    navigator as Navigator & {
      userAgentData?: { platform?: string };
    }
  ).userAgentData?.platform;
  return /Mac|iPhone|iPad|iPod/i.test(
    userAgentDataPlatform || navigator.platform || "",
  );
}

function isPlatformPrimaryModifier(event: KeyboardEvent) {
  return isApplePlatform()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

function normalizedKey(event: KeyboardEvent) {
  if (event.key === " ") return "space";
  // Alt-held combos: derive the letter/punctuation from the physical key
  // position (event.code) instead of the composed character (event.key).
  // See ALT_CODE_KEYS above for why. Falls back to the plain event.key
  // handling below for codes we don't map (e.g. Escape, Tab, arrows), so
  // non-letter alt combos are unaffected.
  if (event.altKey) {
    const fromCode = ALT_CODE_KEYS[event.code];
    if (fromCode) return fromCode;
  }
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

function digitFromEvent(event: KeyboardEvent) {
  if (event.code.startsWith("Digit")) return event.code.slice("Digit".length);
  return /^[0-9]$/.test(event.key) ? event.key : "";
}
