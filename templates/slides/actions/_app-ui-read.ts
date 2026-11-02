import type { ActionRunContext } from "@agent-native/core/action";

// A read saves a background repair only for the app's own signed-in UI; every
// other caller can hold a read-only grant and must get a pure read. The
// frontend caller is only the client's claim, so a request that also carries
// a bearer credential is an outside client, not the app UI.
export function isAppUiRead(ctx: ActionRunContext | undefined): boolean {
  return (
    ctx?.caller === "frontend" &&
    ctx.requestHeaders?.has("authorization") !== true
  );
}
