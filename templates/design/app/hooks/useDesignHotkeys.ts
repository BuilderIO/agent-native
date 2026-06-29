import { useEffect, useRef } from "react";

export type DesignHotkeyTool =
  | "move"
  | "frame"
  | "rectangle"
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
}

const TOOL_SHORTCUTS: Record<
  string,
  { tool: DesignHotkeyTool; handler: keyof UseDesignHotkeysProps }
> = {
  v: { tool: "move", handler: "onMoveTool" },
  f: { tool: "frame", handler: "onFrameTool" },
  r: { tool: "rectangle", handler: "onRectangleTool" },
  t: { tool: "text", handler: "onTextTool" },
  p: { tool: "pen", handler: "onPenTool" },
  h: { tool: "hand", handler: "onHandTool" },
  c: { tool: "comment", handler: "onCommentTool" },
  k: { tool: "scale", handler: "onScaleTool" },
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

  useEffect(() => {
    propsRef.current = props;
  }, [props]);

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
    !isFocusableChromeTarget(event.target)
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
  if (primary && key === "g") {
    return event.shiftKey ? run(props.onUngroup) : run(props.onGroup);
  }

  if (primary && (key === "=" || key === "+")) return run(props.onZoomIn);
  if (primary && key === "-") return run(props.onZoomOut);
  if (primary && key === "0") return run(props.onZoomReset);

  const digit = digitFromEvent(event);
  if ((primary || event.shiftKey) && digit === "1") {
    return run(props.onZoomToFit);
  }
  if ((primary || event.shiftKey) && digit === "2") {
    return run(props.onZoomToSelection);
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
