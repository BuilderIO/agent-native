import { createContext, useContext } from "react";

/**
 * Whether the root shell has finished swapping in its final tree.
 *
 * `AgentSidebar` wraps the whole app surface and is loaded with `lazy()`, so
 * when its chunk resolves React unmounts the placeholder subtree and mounts a
 * fresh one -- every page element below it is destroyed and rebuilt. Static
 * content re-renders invisibly, but anything holding mount-time state pays for
 * it: the hero's WebGPU renderer was building its whole graph twice and
 * restarting its fade, which read as the background flashing mid-animation.
 *
 * Components that own expensive or animated mount-time state should wait for
 * this before mounting, so they mount once into the final tree.
 */
const ShellSettledContext = createContext(false);

export const ShellSettledProvider = ShellSettledContext.Provider;

export function useShellSettled(): boolean {
  return useContext(ShellSettledContext);
}
