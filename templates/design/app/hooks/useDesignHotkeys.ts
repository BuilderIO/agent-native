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
  onScaleTool?: DesignHotkeyHandler;
  onCopy?: DesignHotkeyHandler;
  onCut?: DesignHotkeyHandler;
  onPaste?: DesignHotkeyHandler;
  onPasteOver?: DesignHotkeyHandler;
  onCopyProps?: DesignHotkeyHandler;
  onPasteProps?: DesignHotkeyHandler;
  onCopyAsCode?: DesignHotkeyHandler;
  onDuplicate?: DesignHotkeyHandler;
  onDelete?: DesignHotkeyHandler;
  onRename?: DesignHotkeyHandler;
  onSelectAll?: DesignHotkeyHandler;
  onGroup?: DesignHotkeyHandler;
  onUngroup?: DesignHotkeyHandler;
  onUndo?: DesignHotkeyHandler;
  onRedo?: DesignHotkeyHandler;
  onBringForward?: DesignHotkeyHandler;
  onBringToFront?: DesignHotkeyHandler;
  onSendBackward?: DesignHotkeyHandler;
  onSendToBack?: DesignHotkeyHandler;
  onEscape?: DesignHotkeyHandler;
  onEnter?: DesignHotkeyHandler;
  onTab?: DesignHotkeyTabHandler;
  onNudge?: DesignHotkeyNudgeHandler;
  onZoomIn?: DesignHotkeyHandler;
  onZoomOut?: DesignHotkeyHandler;
  onZoomReset?: DesignHotkeyHandler;
  onZoomToFit?: DesignHotkeyHandler;
  onZoomToSelection?: DesignHotkeyHandler;
  /** Figma's Shift+0 — zoom to 100%. Distinct from onZoomReset (Cmd+0). */
  onZoomTo100?: DesignHotkeyHandler;
  /** Figma's Cmd+Alt+K — create component from the current selection. */
  onCreateComponent?: DesignHotkeyHandler;
  /**
   * Figma's plain digit 1-9 / 0 — set selection opacity (10-90%, 0 = 100%).
   * Only fires when a layer is selected (caller decides via presence of the
   * handler / its own guard) and the event isn't a modifier combo or an
   * editable-target keystroke (already filtered by ignoreEditableTargets).
   */
  onOpacityChange?: DesignHotkeyOpacityHandler;
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
  c: { tool: "comment", handler: "onCommentTool" },
  k: { tool: "scale", handler: "onScaleTool" },
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
  if (
    event.key === "Tab" &&
    props.onTab &&
    // Ignore synthetic (non-trusted) Tab events dispatched by handleIframeHotkey
    // unless they carry the iframe-hotkey marker. This keeps inspector field
    // tabbing native while allowing real iframe canvas Tab presses to cycle files.
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

  if (primary && key === "z") {
    return event.shiftKey ? run(props.onRedo) : run(props.onUndo);
  }
  if (primary && key === "y") return run(props.onRedo);
  if (primary && key === "a") return run(props.onSelectAll);
  if (primary && key === "x") return run(props.onCut);
  if (primary && key === "c") {
    if (event.altKey) return run(props.onCopyProps);
    if (event.shiftKey) return run(props.onCopyAsCode);
    return run(props.onCopy);
  }
  if (primary && key === "v") {
    if (event.altKey) return run(props.onPasteProps);
    if (event.shiftKey) return run(props.onPasteOver);
    return run(props.onPaste);
  }
  if (primary && key === "d") return run(props.onDuplicate);
  if (primary && key === "r") return run(props.onRename);
  if (primary && key === "g") {
    // Figma uses ⇧⌘G for ungroup; also support ⌥⌘G as an alias.
    if (event.shiftKey || event.altKey) return run(props.onUngroup);
    return run(props.onGroup);
  }

  if (primary && (key === "=" || key === "+")) return run(props.onZoomIn);
  if (primary && key === "-") return run(props.onZoomOut);
  if (primary && key === "0") return run(props.onZoomReset);

  // H2: Cmd+Alt+K — create component from the current selection.
  if (primary && event.altKey && key === "k") {
    return run(props.onCreateComponent);
  }

  const digit = digitFromEvent(event);
  if (event.shiftKey && !primary && digit === "1") {
    return run(props.onZoomToFit);
  }
  if (event.shiftKey && !primary && digit === "2") {
    return run(props.onZoomToSelection);
  }
  // H2: Shift+0 — zoom to 100%. Distinct from Cmd+0 (onZoomReset above).
  if (event.shiftKey && !primary && !event.altKey && digit === "0") {
    return run(props.onZoomTo100);
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

  if (primary && key === "]") {
    return event.altKey ? run(props.onBringToFront) : run(props.onBringForward);
  }
  if (primary && key === "[") {
    return event.altKey ? run(props.onSendToBack) : run(props.onSendBackward);
  }

  return false;
}

function normalizedKey(event: KeyboardEvent) {
  if (event.key === " ") return "space";
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

function digitFromEvent(event: KeyboardEvent) {
  if (event.code.startsWith("Digit")) return event.code.slice("Digit".length);
  return /^[0-9]$/.test(event.key) ? event.key : "";
}
