import { describe, expect, it } from "vitest";

import { buildDispatchNavigationState } from "./use-navigation-state.js";

describe("buildDispatchNavigationState", () => {
  it("recognizes the full-page chat route", () => {
    expect(buildDispatchNavigationState("/chat")).toEqual({
      view: "chat",
      path: "/chat",
    });
  });

  it("recognizes the embedded browser chat route", () => {
    expect(buildDispatchNavigationState("/browser-chat")).toEqual({
      view: "browser-chat",
      path: "/browser-chat",
    });
  });

  it("exposes the current extension id from extension routes", () => {
    expect(
      buildDispatchNavigationState("/extensions/ext-1/github-stars-over-time"),
    ).toEqual({
      view: "extensions",
      path: "/extensions/ext-1/github-stars-over-time",
      extensionId: "ext-1",
      extensionSlug: "github-stars-over-time",
    });
  });

  it("preserves dreams query context", () => {
    expect(
      buildDispatchNavigationState(
        "/dreams",
        "?dreamId=dream-1&sourceId=src-1&query=focus",
      ),
    ).toEqual({
      view: "dreams",
      path: "/dreams",
      dreamId: "dream-1",
      sourceId: "src-1",
      query: "focus",
    });
  });

  it("recognizes the automations route", () => {
    expect(buildDispatchNavigationState("/automations")).toEqual({
      view: "automations",
      path: "/automations",
    });
  });

  it("recognizes Admin routes without losing the underlying view", () => {
    expect(buildDispatchNavigationState("/admin/metrics")).toEqual({
      view: "metrics",
      path: "/admin/metrics",
    });
    expect(buildDispatchNavigationState("/admin")).toEqual({
      view: "admin",
      path: "/admin",
    });
  });

  it("preserves thread debug filters and selection", () => {
    expect(
      buildDispatchNavigationState(
        "/thread-debug",
        "?mode=failures&source=all&inspectSource=mail&owner=ops%40example.com&status=errored&range=7d&query=timeout&runId=run-1&threadId=thread-1",
      ),
    ).toEqual({
      view: "thread-debug",
      path: "/thread-debug",
      threadDebugMode: "failures",
      sourceId: "all",
      inspectSourceId: "mail",
      ownerEmail: "ops@example.com",
      failureStatus: "errored",
      range: "7d",
      query: "timeout",
      runId: "run-1",
      threadId: "thread-1",
    });
  });

  it("omits empty thread debug query values", () => {
    expect(
      buildDispatchNavigationState(
        "/thread-debug",
        "?mode=&source=&inspectSource=&owner=&status=&range=&query=&runId=&threadId=",
      ),
    ).toEqual({
      view: "thread-debug",
      path: "/thread-debug",
    });
  });

  it("does not expose thread debug query state on unrelated routes", () => {
    expect(
      buildDispatchNavigationState(
        "/overview",
        "?mode=failures&source=all&inspectSource=mail&owner=ops%40example.com&status=errored&range=7d&query=timeout&runId=run-1&threadId=thread-1",
      ),
    ).toEqual({
      view: "overview",
      path: "/overview",
    });
  });
});
