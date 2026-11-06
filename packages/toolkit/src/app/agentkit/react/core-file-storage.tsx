import { createContext, type ComponentType, type RefObject } from "react";

type SetupProps = {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
} & ({ status: "missing" } | { status: "unavailable"; onRetry: () => void });

export const CoreFileStorageSetupContext = createContext<{
  scopeKey: string;
  readStatus: () => Promise<{ configured: boolean }>;
  Setup: ComponentType<SetupProps>;
} | null>(null);
