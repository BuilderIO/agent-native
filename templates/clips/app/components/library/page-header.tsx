import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";

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

export function PageBreadcrumb({ label }: { label: string }) {
  return (
    <Breadcrumb aria-label={label} className="min-w-0">
      <BreadcrumbList className="flex-nowrap overflow-hidden">
        <BreadcrumbItem className="min-w-0">
          <BreadcrumbPage className="truncate font-medium">
            {label}
          </BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
