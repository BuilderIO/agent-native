import { useEffect, useLayoutEffect, useRef } from "react";

import { createDesignCanvasInteractionAdapter } from "@/components/design/canvas-interactions/design-canvas-interactions";

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
  onCopyAsPng?: DesignHotkeyHandler;
  onCut?: DesignHotkeyHandler;
  onPaste?: DesignHotkeyHandler;
  onPasteOver?: DesignHotkeyHandler;
  onPlaceImage?: DesignHotkeyHandler;
  onCopyProps?: DesignHotkeyHandler;
  onPasteProps?: DesignHotkeyHandler;
  onDuplicate?: DesignHotkeyHandler;
  onDelete?: DesignHotkeyHandler;
  onRename?: DesignHotkeyHandler;
  onFind?: DesignHotkeyHandler;
  onShowLayersPanel?: DesignHotkeyHandler;
  onShowAssetsPanel?: DesignHotkeyHandler;
  onSelectAll?: DesignHotkeyHandler;
  onGroup?: DesignHotkeyHandler;
  onUngroup?: DesignHotkeyHandler;
  onFrameSelection?: DesignHotkeyHandler;
  onBooleanSubtract?: DesignHotkeyHandler;
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
  onCreateComponent?: DesignHotkeyHandler;
  onDetachInstance?: DesignHotkeyHandler;
  onOpacityChange?: DesignHotkeyOpacityHandler;
  opacitySelectionKey?: string | null;
  onToggleHidden?: DesignHotkeyHandler;
  onToggleLocked?: DesignHotkeyHandler;
  onToggleUnderline?: DesignHotkeyHandler;
  onToggleStrikethrough?: DesignHotkeyHandler;
  onFlipHorizontal?: DesignHotkeyHandler;
  onFlipVertical?: DesignHotkeyHandler;
  onSwapFillStroke?: DesignHotkeyHandler;
  onPasteToReplace?: DesignHotkeyHandler;
  onEyedropper?: DesignHotkeyHandler;
  onAlignSelection?: DesignHotkeyAlignHandler;
  onDistributeSelection?: DesignHotkeyDistributeHandler;
  onTidyUp?: DesignHotkeyHandler;
  onAddAutoLayout?: DesignHotkeyHandler;
  canClaimBoundChords?: boolean;
  onToggleUi?: DesignHotkeyHandler;
  onToggleMinimalUi?: DesignHotkeyHandler;
  onToggleLayoutGrids?: DesignHotkeyHandler;
  onToggleComments?: DesignHotkeyHandler;
  onShowKeyboardShortcuts?: DesignHotkeyHandler;
}

const OPACITY_SEQUENCE_WINDOW_MS = 1000;

const TOOL_SHORTCUTS: Record<
  string,
  { tool: DesignHotkeyTool; handler: keyof UseDesignHotkeysProps }
> = {
  v: { tool: "move", handler: "onMoveTool" },
  f: { tool: "frame", handler: "onFrameTool" },
  a: { tool: "frame", handler: "onFrameTool" },
  r: { tool: "rectangle", handler: "onRectangleTool" },
  o: { tool: "ellipse", handler: "onEllipseTool" },
  l: { tool: "line", handler: "onLineTool" },
  t: { tool: "text", handler: "onTextTool" },
  p: { tool: "pen", handler: "onPenTool" },
  h: { tool: "hand", handler: "onHandTool" },
  k: { tool: "scale", handler: "onScaleTool" },
  c: { tool: "comment", handler: "onCommentTool" },
};

const SHIFT_TOOL_SHORTCUTS: Record<
  string,
  { tool: DesignHotkeyTool; handler: keyof UseDesignHotkeysProps }
> = {
  l: { tool: "arrow", handler: "onArrowTool" },
  y: { tool: "draw", handler: "onDrawTool" },
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

export function isDesignHistoryHotkeyTarget(target: EventTarget | null) {
  if (!target || typeof Element === "undefined") return false;
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("[data-design-history-hotkeys]"));
}

function isDesignHistoryHotkey(event: KeyboardEvent) {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")
  );
}

export function hasDocumentTextSelection() {
  if (typeof window === "undefined" || !window.getSelection) return false;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return false;
  }
  return selection.toString().trim().length > 0;
}

export function isShowKeyboardShortcutsHotkey(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) {
    return false;
  }
  const key = normalizedKey(event);
  return key === "?" || key === "/";
}

function isFocusableChromeTarget(target: EventTarget | null) {
  if (!target || typeof Element === "undefined") return false;
  if (!(target instanceof Element)) return false;
  if (target === document.body || target === document.documentElement) {
    return false;
  }
  if (target.closest("[data-layer-row-button]")) return false;
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

export function isNativeKeyboardActivationTarget(target: EventTarget | null) {
  if (!target || typeof Element === "undefined") return false;
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest("a[href], button, input, select, textarea, summary"),
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

    let opacityDigits = "";
    let opacityLastDigitAt = 0;
    let opacitySelectionKey: string | null = null;

    const resetOpacitySequence = () => {
      opacityDigits = "";
      opacityLastDigitAt = 0;
      opacitySelectionKey = null;
    };

    const applyOpacityDigit = (
      event: KeyboardEvent,
      digit: string,
      current: UseDesignHotkeysProps,
    ) => {
      const selectionKey = current.opacitySelectionKey ?? null;
      const now = Date.now();
      if (
        selectionKey !== opacitySelectionKey ||
        now - opacityLastDigitAt > OPACITY_SEQUENCE_WINDOW_MS
      ) {
        opacityDigits = "";
      }
      opacitySelectionKey = selectionKey;
      opacityDigits = `${opacityDigits}${digit}`.slice(-2);
      opacityLastDigitAt = now;
      const opacity =
        opacityDigits === "0"
          ? 100
          : Math.min(
              100,
              opacityDigits.length === 1
                ? Number(opacityDigits) * 10
                : Number(opacityDigits),
            );
      if (current.preventDefault !== false) event.preventDefault();
      current.onOpacityChange?.({
        event,
        key: normalizedKey(event),
        primary: false,
        shift: false,
        alt: false,
        repeat: event.repeat,
        opacity,
      });
    };

    const handleKeyDown = (event: Event) => {
      if (!(event instanceof KeyboardEvent)) return;
      const current = propsRef.current;
      if (current.enabled === false) {
        resetOpacitySequence();
        return;
      }
      if (event.defaultPrevented || event.isComposing) {
        resetOpacitySequence();
        return;
      }
      if (current.shouldHandleEvent && !current.shouldHandleEvent(event)) {
        resetOpacitySequence();
        return;
      }
      if (
        current.ignoreEditableTargets !== false &&
        isDesignHotkeyEditableTarget(event.target) &&
        !isShowKeyboardShortcutsHotkey(event) &&
        !(
          isDesignHistoryHotkey(event) &&
          isDesignHistoryHotkeyTarget(event.target)
        )
      ) {
        resetOpacitySequence();
        return;
      }

      const digit = digitFromEvent(event);
      if (
        digit &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        current.onOpacityChange
      ) {
        applyOpacityDigit(event, digit, current);
        return;
      }

      resetOpacitySequence();

      handleDesignHotkey(event, current);
    };

    const handleBoundary = () => resetOpacitySequence();

    eventTarget.addEventListener("keydown", handleKeyDown, {
      capture: props.capture,
    });
    eventTarget.addEventListener("pointerdown", handleBoundary);
    eventTarget.addEventListener("focusin", handleBoundary);
    eventTarget.addEventListener("blur", handleBoundary);
    return () => {
      resetOpacitySequence();
      eventTarget.removeEventListener("keydown", handleKeyDown, {
        capture: props.capture,
      });
      eventTarget.removeEventListener("pointerdown", handleBoundary);
      eventTarget.removeEventListener("focusin", handleBoundary);
      eventTarget.removeEventListener("blur", handleBoundary);
    };
  }, [props.capture, props.enabled, props.opacitySelectionKey, props.target]);
}

export function handleDesignHotkey(
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

  const claim = (handler: DesignHotkeyHandler | undefined) => {
    if (!handler && props.canClaimBoundChords === false) return false;
    prevent();
    handler?.(details);
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

  const designCanvasInteractions = createDesignCanvasInteractionAdapter({
    shortcuts: props,
  });

  const runSharedCanvasCommand = () => {
    const result = designCanvasInteractions.dispatchKeyboardEvent(event);
    if (!result.handled) return false;
    prevent();
    return true;
  };

  if (isShowKeyboardShortcutsHotkey(event)) {
    return run(props.onShowKeyboardShortcuts);
  }

  if (!primary && !event.altKey && event.shiftKey) {
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

  if (!primary && event.altKey && event.shiftKey && key === "s") {
    return run(props.onBooleanSubtract);
  }

  if (event.key.startsWith("Arrow") && !primary && !event.altKey) {
    return runSharedCanvasCommand();
  }

  if (event.key === "Escape") return run(props.onEscape);
  if (event.key === "Enter") {
    if (
      isNativeKeyboardActivationTarget(event.target) &&
      !(
        event.target instanceof Element &&
        event.target.closest("[data-layer-row-button]")
      )
    ) {
      return false;
    }
    if (event.shiftKey && props.onSelectParent) {
      return run(props.onSelectParent);
    }
    return run(props.onEnter);
  }
  if (!primary && !event.altKey && !event.shiftKey && key === "\\") {
    return run(props.onSelectParent);
  }
  if (
    event.key === "Tab" &&
    props.onTab &&
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
    return runSharedCanvasCommand() || run(props.onDelete);
  }

  if (primary && !event.altKey && !event.shiftKey && key === "Backspace") {
    return claim(props.onUngroup);
  }

  if (primary && key === "z") {
    return (
      runSharedCanvasCommand() ||
      (event.shiftKey ? claim(props.onRedo) : claim(props.onUndo))
    );
  }
  if (primary && key === "y") return claim(props.onRedo);
  if (
    isPlatformPrimaryModifier(event) &&
    !event.altKey &&
    !event.shiftKey &&
    key === "f"
  ) {
    return run(props.onFind);
  }
  if (primary && !event.altKey && !event.shiftKey && key === "a") {
    return runSharedCanvasCommand() || run(props.onSelectAll);
  }
  if (primary && event.shiftKey && key === "x") {
    return claim(props.onToggleStrikethrough);
  }
  if (primary && key === "x" && !hasDocumentTextSelection()) {
    return runSharedCanvasCommand() || run(props.onCut);
  }
  if (primary && !event.altKey && !event.shiftKey && key === "u") {
    return claim(props.onToggleUnderline);
  }

  if (event.ctrlKey && event.altKey && !event.metaKey && !event.shiftKey) {
    if (key === "h") return runDistribute("horizontal");
    if (key === "v") return runDistribute("vertical");
  }

  if (!primary && !event.altKey && !event.shiftKey && key === "i") {
    return run(props.onEyedropper);
  }

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
    if (hasDocumentTextSelection()) return false;
    return runSharedCanvasCommand() || run(props.onCopy);
  }
  if (primary && key === "v") {
    if (event.altKey) return run(props.onPasteProps);
    if (event.shiftKey) return run(props.onPasteOver);
    return runSharedCanvasCommand() || run(props.onPaste);
  }
  if (primary && key === "d") {
    return runSharedCanvasCommand() || claim(props.onDuplicate);
  }
  if (primary && !event.altKey && !event.shiftKey && key === "r") {
    return claim(props.onRename);
  }
  if (primary && event.shiftKey && key === "r") {
    return run(props.onPasteToReplace);
  }
  if (primary && event.shiftKey && !event.altKey && key === "k") {
    return claim(props.onPlaceImage);
  }
  if (primary && event.shiftKey && key === "h") {
    return claim(props.onToggleHidden);
  }
  if (primary && event.shiftKey && key === "l") {
    return claim(props.onToggleLocked);
  }
  if (primary && key === "g") {
    if (event.altKey) return claim(props.onFrameSelection);
    if (event.shiftKey) return claim(props.onUngroup);
    return claim(props.onGroup);
  }

  if (primary && (key === "=" || key === "+")) return claim(props.onZoomIn);
  if (primary && key === "-") return claim(props.onZoomOut);
  if (primary && key === "0") return claim(props.onZoomReset);

  if (!primary && !event.altKey && !event.shiftKey) {
    if (key === "=" || key === "+") return run(props.onZoomIn);
    if (key === "-") return run(props.onZoomOut);
  }

  if (!primary && !event.altKey && event.shiftKey) {
    if (key === "+" || (key === "=" && event.code === "Equal")) {
      return run(props.onZoomIn);
    }
  }

  if (primary && event.altKey && key === "k") {
    return claim(props.onCreateComponent);
  }

  if (primary && event.altKey && key === "b") {
    return claim(props.onDetachInstance);
  }

  const digit = digitFromEvent(event);
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

  if (
    key === "]" ||
    key === "[" ||
    key === "}" ||
    key === "{" ||
    event.code === "BracketRight" ||
    event.code === "BracketLeft"
  ) {
    return runSharedCanvasCommand();
  }

  if (!primary && !event.altKey && key === "n") {
    return event.shiftKey ? run(props.onPreviousFrame) : run(props.onNextFrame);
  }

  if (!primary && !event.altKey && event.shiftKey && key === "h") {
    return run(props.onFlipHorizontal);
  }
  if (!primary && !event.altKey && event.shiftKey && key === "v") {
    return run(props.onFlipVertical);
  }

  if (!primary && !event.altKey && event.shiftKey && key === "x") {
    return run(props.onSwapFillStroke);
  }

  if (!primary && event.altKey && !event.shiftKey) {
    if (key === "a") return runAlign("left");
    if (key === "d") return runAlign("right");
    if (key === "w") return runAlign("top");
    if (key === "s") return runAlign("bottom");
    if (key === "h") return runAlign("center-h");
    if (key === "v") return runAlign("center-v");
  }

  if (
    event.ctrlKey &&
    event.altKey &&
    !event.metaKey &&
    !event.shiftKey &&
    key === "t"
  ) {
    return run(props.onTidyUp);
  }

  if (!primary && !event.altKey && event.shiftKey && key === "a") {
    return run(props.onAddAutoLayout);
  }

  if (primary && !event.altKey && event.code === "Backslash") {
    return event.shiftKey
      ? claim(props.onToggleMinimalUi)
      : claim(props.onToggleUi);
  }

  if (!primary && !event.altKey && event.shiftKey && key === "c") {
    return run(props.onToggleComments);
  }

  if (event.ctrlKey && !event.metaKey && !event.altKey) {
    if (!event.shiftKey && key === "g") {
      return run(props.onToggleLayoutGrids);
    }
    if (event.shiftKey && event.code === "Digit4") {
      return run(props.onToggleLayoutGrids);
    }
  }

  return false;
}

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

export function isApplePlatform() {
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
