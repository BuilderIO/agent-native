import { describe, expect, it } from "vitest";

import {
  appendAgentAccessParam,
  buildAgentAccessApiUrl,
  buildAgentAccessUrl,
  scopedAgentAccessResourceId,
  toAgentAccessUrl,
} from "./agent-access.js";

describe("agent-access shared helpers", () => {
  it("namespaces resource ids", () => {
    expect(scopedAgentAccessResourceId("clips", "rec-1")).toBe("clips:rec-1");
  });

  it("normalizes origin and base path for relative paths", () => {
    expect(
      toAgentAccessUrl("/sessions/sr_1", {
        origin: "https://analytics.example.com/",
        basePath: "/app/",
      }),
    ).toBe("https://analytics.example.com/app/sessions/sr_1");
  });

  it("does not rewrite absolute URLs", () => {
    expect(
      toAgentAccessUrl("https://other.example.com/x", {
        origin: "https://app.example.com",
        basePath: "/app",
      }),
    ).toBe("https://other.example.com/x");
  });

  it("appends agent access before URL fragments", () => {
    expect(appendAgentAccessParam("/share/rec?view=1#comments", "tok+1")).toBe(
      "/share/rec?view=1&agent_access=tok%2B1#comments",
    );
  });

  it("builds a page URL with a configurable token param", () => {
    expect(
      buildAgentAccessUrl({
        path: "/share/rec-1",
        token: "tok",
        origin: "https://clips.example.com",
        basePath: "/clips",
        tokenParam: "t",
      }),
    ).toBe("https://clips.example.com/clips/share/rec-1?t=tok");
  });

  it("builds API URLs with id, token, and extra params", () => {
    expect(
      buildAgentAccessApiUrl({
        endpoint: "/api/context.json",
        resourceId: "rec 1",
        token: "tok",
        origin: "https://clips.example.com",
        basePath: "/clips",
        extraParams: [
          ["atMs", 1234],
          ["empty", ""],
        ],
      }),
    ).toBe(
      "https://clips.example.com/clips/api/context.json?id=rec+1&agent_access=tok&atMs=1234",
    );
  });
});
