import { createContext, useContext, type ReactNode } from "react";

/**
 * Flags that a block is rendered inside a WIDTH-CONSTRAINED container — a `tabs`
 * tab panel or a `columns`/`Column` cell. Width-sensitive blocks (today the
 * `diff` block) read this to pick a default layout that survives the narrower
 * box: e.g. a diff with NO authored `mode` defaults to `unified` inside one of
 * these containers instead of `split`, whose doubled line-number gutters crush
 * the code in a half-width or vertical-tab column.
 *
 * It only nudges the DEFAULT. An explicitly authored mode (`mode="split"`) still
 * wins, and the in-block Unified/Split toggle still works in either context —
 * this never disables side-by-side, it just changes what you get before you pick.
 *
 * Lives in core beside the blocks so both the containers (`tabs`, `columns`) and
 * the consumers (`DiffBlock`) share one source of truth without a new dep.
 */
const NarrowContainerContext = createContext(false);

/** True when the current block renders inside a tab panel or a column cell. */
export function useInNarrowContainer(): boolean {
  return useContext(NarrowContainerContext);
}

/**
 * Marks its subtree as living inside a width-constrained container. Wrap the
 * children a `tabs`/`columns` block renders so nested width-sensitive blocks can
 * pick a container-appropriate default. Idempotent: nesting the provider keeps
 * the flag `true`.
 */
export function NarrowContainerProvider({ children }: { children: ReactNode }) {
  return (
    <NarrowContainerContext.Provider value={true}>
      {children}
    </NarrowContainerContext.Provider>
  );
}
