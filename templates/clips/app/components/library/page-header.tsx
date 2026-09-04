import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";

interface PageHeaderSlotContextValue {
  slot: HTMLElement | null;
  sidebarHasNewRecordingAction: boolean;
}

const PageHeaderSlotContext = createContext<PageHeaderSlotContextValue>({
  slot: null,
  sidebarHasNewRecordingAction: false,
});

export function PageHeaderSlotProvider({
  slot,
  sidebarHasNewRecordingAction,
  children,
}: {
  slot: HTMLElement | null;
  sidebarHasNewRecordingAction: boolean;
  children: ReactNode;
}) {
  return (
    <PageHeaderSlotContext.Provider
      value={{ slot, sidebarHasNewRecordingAction }}
    >
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
