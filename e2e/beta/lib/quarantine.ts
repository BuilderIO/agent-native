import { test } from "@playwright/test";

/**
 * Skips, as a quarantine, a test that bills a model turn on the Chat host. The
 * description starts `QUARANTINED` so the failure digest lists it by name
 * instead of counting it as an ordinary skip; drop the call once the Chat app
 * puts the engine on the wire.
 */
export function quarantineChatHostSpend(siteId: string): void {
  test.fixme(
    siteId === "chat",
    "QUARANTINED steve until 2026-10-15: the Chat app sends the picked engine in request metadata, which the server ignores, so its turns carry the luna model but no engine and the spend guard cannot prove the dedicated key (see e2e/beta/README.md)",
  );
}
