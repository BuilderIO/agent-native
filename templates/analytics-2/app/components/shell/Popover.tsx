import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

import {
  computePopoverPlacement,
  type PopoverPlacement,
} from "./popover-position";

export interface PopoverTriggerProps {
  ref: Ref<HTMLButtonElement>;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  "aria-expanded": boolean;
  "aria-haspopup": "menu" | "dialog";
  "aria-controls": string;
}

interface PopoverProps {
  openBinding?: { value: boolean; set?: (open: boolean) => void };
  label: string;
  role: "menu" | "dialog";
  placement?: "bottom-start" | "top-start";
  minWidth?: number;
  className?: string;
  allowOverflow?: boolean;
  trigger: (props: PopoverTriggerProps) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
}

export function Popover({
  openBinding,
  label,
  role,
  placement = "bottom-start",
  minWidth = 180,
  className,
  allowOverflow = false,
  trigger,
  children,
}: PopoverProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = openBinding?.value ?? localOpen;
  const setOpen = openBinding ? openBinding.set : setLocalOpen;
  const [position, setPosition] = useState<
    Omit<PopoverPlacement, "maxHeight"> & { maxHeight: number | undefined }
  >({
    top: 0,
    left: 8,
    maxWidth: 320,
    maxHeight: openBinding ? undefined : 480,
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const isControlled = openBinding !== undefined;
  const [scrollMenu, setScrollMenu] = useState(false);

  const close = useCallback(
    (restoreFocus = false) => {
      setOpen?.(false);
      if (restoreFocus) triggerRef.current?.focus();
    },
    [setOpen],
  );

  const openPopover = useCallback(() => setOpen?.(true), [setOpen]);

  const updatePosition = useCallback(() => {
    const triggerElement = triggerRef.current;
    if (!triggerElement) return;
    const rect = triggerElement.getBoundingClientRect();
    const hasTriggerLayout = rect.bottom > rect.top || !isControlled;
    const next = computePopoverPlacement({
      rect,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      placement,
      minWidth,
      hasTriggerLayout,
    });
    setPosition({
      ...next,
      maxHeight: hasTriggerLayout ? next.maxHeight : undefined,
    });
  }, [isControlled, minWidth, placement]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const content = panel?.firstElementChild;
    if (!open || !allowOverflow || !panel || !content) {
      setScrollMenu(false);
      return;
    }
    const updateScrollMenu = () => {
      const { paddingTop, paddingBottom } = getComputedStyle(panel);
      const padding =
        (parseFloat(paddingTop) || 0) + (parseFloat(paddingBottom) || 0);
      setScrollMenu(
        content.getBoundingClientRect().height + padding >
          panel.clientHeight + 1,
      );
    };
    updateScrollMenu();
    const observer = new ResizeObserver(updateScrollMenu);
    observer.observe(panel);
    observer.observe(content);
    return () => observer.disconnect();
  }, [allowOverflow, open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      close();
    };
    let frame = 0;
    const handleViewportChange = (event: Event) => {
      if (
        event.target instanceof Node &&
        panelRef.current?.contains(event.target)
      )
        return;
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        updatePosition();
      });
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [close, open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      if (role === "menu") {
        const firstItem = panelRef.current?.querySelector<HTMLElement>(
          '[data-menu-item="true"]:not(:disabled)',
        );
        if (firstItem) {
          firstItem.focus();
          return;
        }
      }
      panelRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, role]);

  const handlePanelKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
        return;
      }
      if (event.key === "Tab") {
        close();
        return;
      }
      if (role !== "menu") return;
      const items = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          '[data-menu-item="true"]:not(:disabled)',
        ) ?? [],
      );
      if (items.length === 0) return;
      const activeIndex = items.indexOf(document.activeElement as HTMLElement);
      let nextIndex: number | null = null;
      if (event.key === "ArrowDown") {
        nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % items.length;
      } else if (event.key === "ArrowUp") {
        nextIndex =
          activeIndex <= 0
            ? items.length - 1
            : (activeIndex - 1) % items.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = items.length - 1;
      }
      if (nextIndex === null) return;
      event.preventDefault();
      items[nextIndex]?.focus();
    },
    [close, role],
  );

  const handleTriggerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openPopover();
      } else if (event.key === "Escape" && open) {
        event.preventDefault();
        close(true);
      }
    },
    [close, open, openPopover],
  );

  return (
    <>
      {trigger({
        ref: triggerRef,
        onClick: () => {
          if (open) close();
          else openPopover();
        },
        onKeyDown: handleTriggerKeyDown,
        "aria-expanded": open,
        "aria-haspopup": role,
        "aria-controls": open ? panelId : "",
      })}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role={role}
            aria-label={label}
            tabIndex={-1}
            className={[
              "ws-popover",
              allowOverflow ? "ws-allow-overflow" : "",
              className,
            ]
              .filter(Boolean)
              .join(" ")}
            data-scroll-menu={scrollMenu || undefined}
            style={{
              top: position.top,
              bottom: position.bottom,
              left: position.left,
              minWidth,
              maxWidth: position.maxWidth,
              maxHeight: position.maxHeight,
              overflowY:
                position.maxHeight !== undefined && !allowOverflow
                  ? "auto"
                  : undefined,
            }}
            onKeyDown={handlePanelKeyDown}
          >
            {typeof children === "function"
              ? children(() => close())
              : children}
          </div>,
          document.body,
        )}
    </>
  );
}
