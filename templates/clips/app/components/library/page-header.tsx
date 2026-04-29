import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";

const PageHeaderSlotContext = createContext<HTMLElement | null>(null);

export function PageHeaderSlotProvider({
  slot,
  children,
}: {
  slot: HTMLElement | null;
  children: ReactNode;
}) {
  return (
    <PageHeaderSlotContext.Provider value={slot}>
      {children}
    </PageHeaderSlotContext.Provider>
  );
}

export function PageHeader({ children }: { children: ReactNode }) {
  const slot = useContext(PageHeaderSlotContext);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready || !slot) return null;
  return createPortal(children, slot);
}
