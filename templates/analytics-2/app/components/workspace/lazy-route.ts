import { recoverFromStaleChunkError } from "@agent-native/core/client/route-chunk-recovery";
import { lazy, type ComponentType } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a route page takes
// whatever props its own entry declares; the wrapper only needs "a component".
type AnyRoutePage = ComponentType<any>;

/**
 * A lazily loaded route page that does not tear the shell down when its chunk
 * cannot be fetched.
 *
 * After a deploy the chunk a page was split into no longer exists at that hash, so
 * the first navigation into it rejects with a dynamic-import failure. Handed
 * straight to the router, that rejection renders the route error page — the 1-2
 * second "Something went wrong" a reader sees and then loses again once the page
 * recovers. Chunk recovery reloads to the fresh build; while that reload is in
 * flight the page renders nothing, so the shell and the sidebar stay put instead
 * of flashing an error. Every other failure still propagates to the boundary,
 * because a page that truly broke must say so.
 */
export function lazyRoute<T extends AnyRoutePage>(
  loader: () => Promise<{ default: T }>,
) {
  return lazy(async (): Promise<{ default: T }> => {
    try {
      return await loader();
    } catch (error) {
      if (recoverFromStaleChunkError(error)) {
        return { default: (() => null) as unknown as T };
      }
      throw error;
    }
  });
}
