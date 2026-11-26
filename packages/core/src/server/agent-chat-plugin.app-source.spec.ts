import { describe, expect, it } from "vitest";

import { pluginSourceAppId } from "./agent-chat-plugin.js";

/**
 * A template that creates the plugin without `appId` used to write every thread
 * with no source, and the thread store treats a missing source as listable from
 * anywhere — so one app showed another app's chats (team QA class: "an app shows
 * only its own agent chats"). These pin the resolution that replaces it.
 */
describe("pluginSourceAppId", () => {
  it("prefers the id the plugin was created with", () => {
    expect(
      pluginSourceAppId({ appId: "mail-app" }, { app: { id: "other" } }),
    ).toBe("mail-app");
  });

  it("attributes a plugin created without an id to its configured app", () => {
    expect(pluginSourceAppId(undefined, { app: { id: "crm-app" } })).toBe(
      "crm-app",
    );
    expect(pluginSourceAppId({}, { app: { id: "crm-app" } })).toBe("crm-app");
  });

  it("falls back through the config the way route readiness does", () => {
    expect(pluginSourceAppId(undefined, { app: { template: "docs" } })).toBe(
      "docs",
    );
    expect(pluginSourceAppId(undefined, { app: { workspaceId: "ws-1" } })).toBe(
      "ws-1",
    );
    expect(
      pluginSourceAppId(undefined, { app: { packageName: "@acme/thing" } }),
    ).toBe("@acme/thing");
  });

  it("never invents an id when nothing is configured", () => {
    expect(pluginSourceAppId(undefined, null)).toBeNull();
    expect(pluginSourceAppId(undefined, {})).toBeNull();
    expect(pluginSourceAppId({ appId: "   " }, { app: { id: "" } })).toBeNull();
  });
});
