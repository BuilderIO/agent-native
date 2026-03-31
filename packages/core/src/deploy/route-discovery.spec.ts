import { describe, it, expect } from "vitest";
import { parseRouteFile } from "./route-discovery.js";

describe("parseRouteFile", () => {
  it("parses a simple GET route", () => {
    expect(parseRouteFile("api/events.get.ts")).toEqual({
      method: "get",
      route: "/api/events",
    });
  });

  it("parses a POST route", () => {
    expect(parseRouteFile("api/users.post.ts")).toEqual({
      method: "post",
      route: "/api/users",
    });
  });

  it("parses PUT, PATCH, DELETE, OPTIONS methods", () => {
    expect(parseRouteFile("api/item.put.ts")?.method).toBe("put");
    expect(parseRouteFile("api/item.patch.ts")?.method).toBe("patch");
    expect(parseRouteFile("api/item.delete.ts")?.method).toBe("delete");
    expect(parseRouteFile("api/cors.options.ts")?.method).toBe("options");
  });

  it("handles index files by stripping /index", () => {
    expect(parseRouteFile("api/emails/index.get.ts")).toEqual({
      method: "get",
      route: "/api/emails",
    });
  });

  it("converts [param] to :param", () => {
    expect(parseRouteFile("api/emails/[id].get.ts")).toEqual({
      method: "get",
      route: "/api/emails/:id",
    });
  });

  it("handles nested params", () => {
    expect(parseRouteFile("api/emails/[id]/star.patch.ts")).toEqual({
      method: "patch",
      route: "/api/emails/:id/star",
    });
  });

  it("converts [...catchall] to **", () => {
    expect(parseRouteFile("api/[...page].get.ts")).toEqual({
      method: "get",
      route: "/api/**",
    });
  });

  it("returns null for files without method extension", () => {
    expect(parseRouteFile("api/utils.ts")).toBeNull();
  });

  it("returns null for invalid method extension", () => {
    expect(parseRouteFile("api/thing.foobar.ts")).toBeNull();
  });

  it("handles .js extensions", () => {
    expect(parseRouteFile("api/hello.get.js")).toEqual({
      method: "get",
      route: "/api/hello",
    });
  });

  it("case-insensitive method matching", () => {
    // The method in the filename is lowercased
    expect(parseRouteFile("api/data.GET.ts")).toEqual({
      method: "get",
      route: "/api/data",
    });
  });

  it("handles multiple path segments", () => {
    expect(parseRouteFile("api/v1/users/[id]/settings.get.ts")).toEqual({
      method: "get",
      route: "/api/v1/users/:id/settings",
    });
  });

  it("handles multiple params in one path", () => {
    expect(parseRouteFile("api/[org]/[repo]/issues.get.ts")).toEqual({
      method: "get",
      route: "/api/:org/:repo/issues",
    });
  });
});
