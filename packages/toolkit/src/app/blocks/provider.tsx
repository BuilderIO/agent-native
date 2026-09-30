import type { BlockRegistry } from "@agent-native/core/blocks/server";
import type { BlockRenderContext } from "@agent-native/core/blocks/server";
import { createContext, useContext, type ReactNode } from "react";

interface BlockRegistryValue {
  registry: BlockRegistry;
  ctx: BlockRenderContext;
}

const BlockRegistryContext = createContext<BlockRegistryValue | null>(null);

export function BlockRegistryProvider({
  registry,
  ctx,
  children,
}: {
  registry: BlockRegistry;
  ctx: BlockRenderContext;
  children: ReactNode;
}) {
  return (
    <BlockRegistryContext.Provider value={{ registry, ctx }}>
      {children}
    </BlockRegistryContext.Provider>
  );
}

export function useBlockRegistry(): BlockRegistryValue {
  const value = useContext(BlockRegistryContext);
  if (!value) {
    throw new Error(
      "useBlockRegistry must be used inside a <BlockRegistryProvider>.",
    );
  }
  return value;
}

export function useOptionalBlockRegistry(): BlockRegistryValue | null {
  return useContext(BlockRegistryContext);
}
