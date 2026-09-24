import {
  type ComponentProps,
  createContext,
  forwardRef,
  Fragment,
  ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { NavLink } from "react-router";

import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button, type ButtonProps } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface PageHeaderSlotContextValue {
  slot: HTMLElement | null;
}

const PageHeaderSlotContext = createContext<PageHeaderSlotContextValue>({
  slot: null,
});

export function PageHeaderSlotProvider({
  slot,
  children,
}: {
  slot: HTMLElement | null;
  children: ReactNode;
}) {
  return (
    <PageHeaderSlotContext.Provider value={{ slot }}>
      {children}
    </PageHeaderSlotContext.Provider>
  );
}

export function usePageHeaderLayout() {
  return useContext(PageHeaderSlotContext);
}

export function PageHeader({ children }: { children: ReactNode }) {
  const { slot } = usePageHeaderLayout();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready || !slot) return null;
  return createPortal(children, slot);
}

export const PageHeaderPrimaryAction = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "size" | "variant">
>(function PageHeaderPrimaryAction({ className, ...props }, ref) {
  return (
    <Button
      ref={ref}
      size="sm"
      variant="default"
      className={cn("shrink-0", className)}
      {...props}
    />
  );
});
PageHeaderPrimaryAction.displayName = "PageHeaderPrimaryAction";

export const PageHeaderActionGroup = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof ButtonGroup>
>(function PageHeaderActionGroup({ className, ...props }, ref) {
  return (
    <ButtonGroup
      ref={ref}
      className={cn(
        "shrink-0 [&>*]:h-9 has-[>input[data-button-group-ignore]]:[&>*:nth-last-child(2)]:!rounded-r-md",
        className,
      )}
      {...props}
    />
  );
});
PageHeaderActionGroup.displayName = "PageHeaderActionGroup";

export interface PageBreadcrumbItem {
  label: string;
  to?: string;
}

/**
 * Collapses breadcrumb segments only as far as the available header width
 * actually requires. Segments closest to the root are hidden first, so the
 * current page and its immediate parent stay visible: a long path degrades
 * to "Root / … / Parent / Current" rather than hiding the nearest ancestor.
 * Re-measures on resize so widening the window (or collapsing the sidebar)
 * brings hidden segments back.
 */
function useBreadcrumbOverflow(itemCount: number) {
  const listRef = useRef<HTMLOListElement>(null);
  const [hiddenCount, setHiddenCount] = useState(0);
  // Middle segments are everything strictly between the root and the
  // current page; the immediate parent is never hidden.
  const maxHidden = Math.max(0, itemCount - 2 - 1);

  // The path changed — start fully expanded and let the measurement below
  // re-collapse only what doesn't fit.
  useLayoutEffect(() => {
    setHiddenCount(0);
  }, [itemCount]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const overflowing = el.scrollWidth > el.clientWidth;
    if (overflowing && hiddenCount < maxHidden) {
      setHiddenCount((count) => count + 1);
    }
  });

  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHiddenCount(0));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { listRef, hiddenCount: Math.min(hiddenCount, maxHidden) };
}

export function PageBreadcrumb({
  items,
}: {
  items: readonly PageBreadcrumbItem[];
}) {
  const { listRef, hiddenCount } = useBreadcrumbOverflow(items.length);

  if (items.length === 0) return null;

  const fullPath = items.map((item) => item.label).join(" / ");
  const collapsed = hiddenCount > 0;
  // Keep the root as an anchor, drop the segments right after it, and keep the
  // whole tail (parent + current) visible.
  const visibleItems = collapsed
    ? [items[0], ...items.slice(1 + hiddenCount)]
    : items;

  const breadcrumb = (
    <Breadcrumb aria-label={fullPath} className="min-w-0">
      <BreadcrumbList ref={listRef} className="flex-nowrap overflow-hidden">
        {visibleItems.map((item, index) => {
          const current = index === visibleItems.length - 1;
          // Ellipsis sits just after the root, standing in for the hidden
          // left-side ancestors.
          const showEllipsisBefore = collapsed && index === 1;

          return (
            <Fragment key={`${item.to ?? "current"}:${item.label}:${index}`}>
              {index > 0 ? <BreadcrumbSeparator className="shrink-0" /> : null}
              {showEllipsisBefore ? (
                <>
                  <BreadcrumbItem className="shrink-0">
                    <BreadcrumbEllipsis className="h-auto w-auto" />
                  </BreadcrumbItem>
                  <BreadcrumbSeparator className="shrink-0" />
                </>
              ) : null}
              <BreadcrumbItem className="shrink-0">
                {current ? (
                  <BreadcrumbPage className="block max-w-64 truncate font-medium">
                    {item.label}
                  </BreadcrumbPage>
                ) : item.to ? (
                  <BreadcrumbLink asChild>
                    <NavLink to={item.to} className="block max-w-48 truncate">
                      {item.label}
                    </NavLink>
                  </BreadcrumbLink>
                ) : (
                  <span className="block max-w-48 truncate">{item.label}</span>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );

  // The tooltip only adds value once ancestors are actually hidden.
  return collapsed ? (
    <Tooltip>
      <TooltipTrigger asChild>{breadcrumb}</TooltipTrigger>
      <TooltipContent>{fullPath}</TooltipContent>
    </Tooltip>
  ) : (
    breadcrumb
  );
}
