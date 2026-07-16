import { beforeEach, describe, expect, it, vi } from "vitest";

const configuredBasePath = vi.hoisted(() => ({ current: "" }));
const getDb = vi.hoisted(() => vi.fn());

vi.mock("@/components/editor/VisualEditor", () => ({
  VisualEditor: () => null,
}));

vi.mock("@agent-native/core/client", () => ({
  setClientAppState: vi.fn(),
  useActionQuery: vi.fn(),
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/server", () => ({
  getConfiguredAppBasePath: () => configuredBasePath.current,
}));

vi.mock("../../server/db", () => ({ getDb }));

import { loader, meta } from "../routes/p.$id";

describe("public document route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configuredBasePath.current = "/content";
  });

  it("returns only opaque route state without querying or serializing content", async () => {
    const result = await loader({
      params: { id: "doc-1" },
      request: new Request(
        "https://content.example.test/p/doc-1?agent_access=secret-token",
      ),
    } as any);

    expect(result).toEqual({ id: "doc-1", basePath: "/content" });
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(getDb).not.toHaveBeenCalled();
  });

  it("uses static, content-free metadata", () => {
    expect(meta({} as never)).toEqual([{ title: "Public document" }]);
  });
});
