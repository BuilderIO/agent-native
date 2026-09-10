import {
  type ComponentProps,
  createContext,
  forwardRef,
  Fragment,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { NavLink } from "react-router";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button, type ButtonProps } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
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

export function PageBreadcrumb({
  items,
}: {
  items: readonly PageBreadcrumbItem[];
}) {
  if (items.length === 0) return null;

  return (
    <Breadcrumb
      aria-label={items.map((item) => item.label).join(" / ")}
      className="min-w-0"
    >
      <BreadcrumbList className="flex-nowrap overflow-hidden">
        {items.map((item, index) => {
          const current = index === items.length - 1;

          return (
            <Fragment key={`${item.to ?? "current"}:${item.label}:${index}`}>
              {index > 0 ? <BreadcrumbSeparator className="shrink-0" /> : null}
              <BreadcrumbItem className={current ? "min-w-0" : "shrink-0"}>
                {current ? (
                  <BreadcrumbPage className="truncate font-medium">
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
}
