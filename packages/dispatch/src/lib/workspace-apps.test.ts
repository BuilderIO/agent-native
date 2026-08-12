import { describe, expect, it } from "vitest";

import { workspaceAppEmbedTarget } from "./workspace-apps";

describe("workspaceAppEmbedTarget", () => {
  it("uses the app URL as the embed root when a mount path is also present", () => {
    expect(
      workspaceAppEmbedTarget({
        path: "/content",
        url: "https://workspace.example.test/content",
      }),
    ).toEqual({ url: "https://workspace.example.test/content" });
  });

  it("falls back to the mounted path when no app URL is available", () => {
    expect(workspaceAppEmbedTarget({ path: "/content", url: null })).toEqual({
      path: "/content",
    });
  });
});
