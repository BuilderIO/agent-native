import { createContext, useContext, type ReactNode } from "react";

import type { BlockRegistry } from "./registry.js";
import type { BlockRenderContext } from "./types.js";

/**
 * React provision for the block registry. The registry itself is a per-app
 * module singleton (so the server MDX serializer/parser and the agent schema
 * export can import it outside React); this thin context threads that singleton
 * plus the runtime {@link BlockRenderContext} (asset resolver, action caller,
 * inline markdown editor, …) into the renderer, and lets tests swap registries.
 */

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

/** Read the active registry + render context. Throws outside a provider. */
export function useBlockRegistry(): BlockRegistryValue {
  const value = useContext(BlockRegistryContext);
  if (!value) {
    throw new Error(
      "useBlockRegistry must be used inside a <BlockRegistryProvider>.",
    );
  }
  return value;
}

/** Read the active registry + render context, or `null` outside a provider. */
export function useOptionalBlockRegistry(): BlockRegistryValue | null {
  return useContext(BlockRegistryContext);
}
