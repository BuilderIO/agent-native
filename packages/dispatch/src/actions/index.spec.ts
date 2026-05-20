import { describe, expect, it } from "vitest";

import { dispatchActions } from "./index.js";

describe("dispatch action registry", () => {
  it("keeps workspace resources runtime-inherited instead of exposing sync actions", () => {
    expect(dispatchActions).toHaveProperty("list-workspace-resources-for-app");
    expect(dispatchActions).toHaveProperty("list-mcp-app-access");
    expect(dispatchActions).toHaveProperty("set-mcp-app-access");
    expect(dispatchActions).toHaveProperty("list_apps");
    expect(dispatchActions).toHaveProperty("ask_app");
    expect(dispatchActions).toHaveProperty("open_app");
    expect(dispatchActions).toHaveProperty("create_embed_session");
    expect(dispatchActions).toHaveProperty(
      "get-workspace-resource-effective-context",
    );
    expect(dispatchActions).toHaveProperty("grant-workspace-resources-to-app");
    expect(dispatchActions).toHaveProperty("sync-vault-to-app");

    expect(dispatchActions).not.toHaveProperty(
      "sync-workspace-resources-to-app",
    );
    expect(dispatchActions).not.toHaveProperty(
      "sync-workspace-resources-to-all",
    );
    expect(
      Object.keys(dispatchActions).filter((name) =>
        name.startsWith("sync-workspace-resources"),
      ),
    ).toEqual([]);
  });
});
