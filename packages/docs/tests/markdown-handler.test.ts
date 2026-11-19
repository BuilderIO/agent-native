import fs from "node:fs";

import { H3 } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server/ssr-handler", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/server/ssr-handler")
  >()),
  createH3SSRHandler: () => async () =>
    new Response("Not found", { status: 404 }),
}));

import getHandler from "../server/routes/[...page].get";
import headHandler from "../server/routes/[...page].head";

afterEach(() => vi.restoreAllMocks());

describe("markdown request handlers without local static files", () => {
  it.each(["GET", "HEAD"])(
    "returns 404 without fetching absent files for %s",
    async (method) => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("timed out"));
      const app = new H3().use(method === "GET" ? getHandler : headHandler);
      for (const pathname of ["/mcp.md", "/developer.md", "/auth.md"]) {
        const response = await app.fetch(
          new Request(`https://www.agent-native.com${pathname}`, { method }),
        );
        expect(response.status, `${method} ${pathname}`).toBe(404);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it.each(["GET", "HEAD"])(
    "serves a public Markdown asset via the mirror on %s",
    async (method) => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("# Public asset\n", {
          headers: { "content-type": "text/markdown; charset=utf-8" },
        }),
      );
      const app = new H3().use(method === "GET" ? getHandler : headHandler);
      const response = await app.fetch(
        new Request(
          "https://www.agent-native.com/examples/self-hosted-chat/README.md",
          { method },
        ),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/markdown");
      expect(await response.text()).toBe(
        method === "GET" ? "# Public asset\n" : "",
      );
      expect(fetchSpy).toHaveBeenCalledOnce();
    },
  );

  it.each(["GET", "HEAD"])(
    "preserves mirror failures for real documents on %s",
    async (method) => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("timed out"));
      const app = new H3().use(method === "GET" ? getHandler : headHandler);
      const response = await app.fetch(
        new Request("https://www.agent-native.com/docs/actions-overview.md", {
          method,
        }),
      );
      expect(response.status).toBe(502);
      expect(fetchSpy).toHaveBeenCalledOnce();
    },
  );
});
