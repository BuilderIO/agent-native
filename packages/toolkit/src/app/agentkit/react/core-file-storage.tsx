import { createContext } from "react";

export const CoreFileStorageSetupContext = createContext<{
  scopeKey: string;
} | null>(null);
