import { ComposerPrimitive } from "@assistant-ui/react";
import { useEffect, useRef } from "react";
import type React from "react";

import { cn } from "../utils.js";
import type { AgentComposerLayoutVariant } from "./types.js";

export interface AgentComposerFrameProps {
  children: React.ReactNode;
  attachedAccessory?: React.ReactNode;
  className?: string;
  workflowClassName?: string;
  rootClassName?: string;
  style?: React.CSSProperties;
  rootStyle?: React.CSSProperties;
  layoutVariant?: AgentComposerLayoutVariant;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

export function AgentComposerFrame({
  children,
  attachedAccessory,
  className,
  workflowClassName,
  rootClassName,
  style,
  rootStyle,
  layoutVariant = "default",
  onClick,
}: AgentComposerFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const shell = frame.closest<HTMLElement>(
      ".agent-layout-shell, .agent-sidebar-shell",
    );
    const viewport = window.visualViewport;
    if (!shell || !viewport) return;
    const activeShell = shell;
    const activeViewport = viewport;

    const viewportHeightProperty = "--agent-native-viewport-height";
    const originalHeight = activeShell.style.getPropertyValue(
      viewportHeightProperty,
    );
    const originalPriority = activeShell.style.getPropertyPriority(
      viewportHeightProperty,
    );
    let keyboardViewportActive = false;
    let listening = false;
    let mounted = true;

    const restoreHeight = () => {
      if (originalHeight) {
        activeShell.style.setProperty(
          viewportHeightProperty,
          originalHeight,
          originalPriority,
        );
      } else {
        activeShell.style.removeProperty(viewportHeightProperty);
      }
    };
    const isEditor = (element: Element | null) =>
      element !== null &&
      frame.contains(element) &&
      element.closest('[contenteditable="true"]') !== null;
    const stopListening = () => {
      if (!listening) return;
      listening = false;
      activeViewport.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
    };
    function update() {
      if (!mounted) return;
      const height = `${activeViewport.height}px`;
      const viewportShrunk = activeViewport.height + 1 < window.innerHeight;
      if (isEditor(document.activeElement)) {
        keyboardViewportActive = viewportShrunk;
        if (viewportShrunk) {
          activeShell.style.setProperty(viewportHeightProperty, height);
        } else {
          restoreHeight();
        }
        return;
      }
      if (keyboardViewportActive && viewportShrunk) {
        activeShell.style.setProperty(viewportHeightProperty, height);
        return;
      }
      keyboardViewportActive = false;
      restoreHeight();
      stopListening();
    }
    const onFocusIn = (event: FocusEvent) => {
      if (!isEditor(event.target instanceof Element ? event.target : null))
        return;
      if (!listening) {
        listening = true;
        activeViewport.addEventListener("resize", update, { passive: true });
        window.addEventListener("resize", update, { passive: true });
      }
      update();
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!isEditor(event.target instanceof Element ? event.target : null))
        return;
      queueMicrotask(update);
    };

    frame.addEventListener("focusin", onFocusIn);
    frame.addEventListener("focusout", onFocusOut);
    return () => {
      mounted = false;
      frame.removeEventListener("focusin", onFocusIn);
      frame.removeEventListener("focusout", onFocusOut);
      stopListening();
      restoreHeight();
    };
  }, []);

  const frame = (
    <div
      ref={frameRef}
      data-agent-composer-variant={layoutVariant}
      data-agent-composer-slot="area"
      className={cn(
        "agent-composer-area min-w-0 shrink-0 py-2",
        attachedAccessory != null && "relative z-10",
        layoutVariant === "compact" ? "px-0" : "px-3",
        layoutVariant !== "default" && `agent-composer-area--${layoutVariant}`,
        className,
      )}
      style={style}
      onClick={onClick}
    >
      <ComposerPrimitive.Root
        data-agent-composer-variant={layoutVariant}
        data-agent-composer-slot="root"
        className={cn(
          "agent-composer-root flex min-w-0 flex-col rounded-lg border border-input transition-colors",
          layoutVariant !== "default" &&
            `agent-composer-root--${layoutVariant}`,
          rootClassName,
        )}
        style={rootStyle}
      >
        {children}
      </ComposerPrimitive.Root>
    </div>
  );

  if (attachedAccessory == null) return frame;

  return (
    <div
      data-agent-composer-slot="workflow"
      data-agent-composer-attached="true"
      className={cn(
        "agent-composer-workflow relative flex w-full flex-col",
        workflowClassName,
      )}
    >
      {attachedAccessory}
      {frame}
    </div>
  );
}
