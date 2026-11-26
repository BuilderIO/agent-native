import { beforeAll, describe, expect, it, vi } from "vitest";

type Registration = {
  getCommandPath: (command: {
    view: "capture" | "search";
    captureId?: string;
    query?: string;
    knowledgeId?: string;
  }) => string;
  getNavigationState: (location: { pathname: string; search: string }) => {
    captureId?: string;
    query?: string;
    selectedKnowledgeId?: string;
  };
};
const registration = vi.hoisted(() => ({
  current: null as Registration | null,
}));
vi.mock("@agent-native/core/client/navigation", () => ({
  useAgentRouteState: (options: Registration) => {
    registration.current = options;
  },
}));
vi.mock("@agent-native/core/client/api-path", () => ({
  appBasePath: () => "",
  appPath: (path: string) => path,
}));

import { useNavigationState } from "./use-navigation-state";

beforeAll(() => {
  useNavigationState();
});

function routeState(): Registration {
  if (!registration.current)
    throw new Error("Navigation state was not registered");
  return registration.current;
}

describe("navigation command roundtrip", () => {
  it("preserves a capture destination when observing the resulting URL", () => {
    const path = routeState().getCommandPath({
      view: "capture",
      captureId: "capture-123",
    });
    expect(path).toBe("/search?captureId=capture-123");
    const url = new URL(path, "https://example.test");
    expect(
      routeState().getNavigationState({
        pathname: url.pathname,
        search: url.search,
      }).captureId,
    ).toBe("capture-123");
  });

  it("preserves query and knowledge selection", () => {
    const path = routeState().getCommandPath({
      view: "search",
      query: "example",
      knowledgeId: "knowledge-123",
    });
    expect(path).toBe("/search?q=example&knowledgeId=knowledge-123");
    const url = new URL(path, "https://example.test");
    expect(
      routeState().getNavigationState({
        pathname: url.pathname,
        search: url.search,
      }),
    ).toMatchObject({ query: "example", selectedKnowledgeId: "knowledge-123" });
  });
});
