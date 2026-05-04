import { afterEach, describe, expect, it } from "vitest";

import { rootDispatchRedirect } from "./pre-auth-routing.js";

const ORIGINAL_BASE_PATH = process.env.APP_BASE_PATH;
const ORIGINAL_VITE_BASE_PATH = process.env.VITE_APP_BASE_PATH;

afterEach(() => {
  if (ORIGINAL_BASE_PATH === undefined) {
    delete process.env.APP_BASE_PATH;
  } else {
    process.env.APP_BASE_PATH = ORIGINAL_BASE_PATH;
  }

  if (ORIGINAL_VITE_BASE_PATH === undefined) {
    delete process.env.VITE_APP_BASE_PATH;
  } else {
    process.env.VITE_APP_BASE_PATH = ORIGINAL_VITE_BASE_PATH;
  }
});

function useDispatchBasePath() {
  process.env.APP_BASE_PATH = "/dispatch";
  delete process.env.VITE_APP_BASE_PATH;
}

describe("dispatch pre-auth routing", () => {
  it("returns a visible 404 for unknown dispatch routes before auth", async () => {
    useDispatchBasePath();

    const response = rootDispatchRedirect("/dispatch/unknown", "");

    expect(response).toBeInstanceOf(Response);
    expect(response?.status).toBe(404);
    await expect(response?.text()).resolves.toBe("Dispatch route not found");
  });

  it("allows known protected dispatch routes to continue to the auth guard", () => {
    useDispatchBasePath();

    expect(rootDispatchRedirect("/dispatch/overview", "")).toBeNull();
    expect(rootDispatchRedirect("/dispatch/approval", "?id=req-1")).toBeNull();
    expect(rootDispatchRedirect("/dispatch/tools", "")).toBeNull();
    expect(rootDispatchRedirect("/dispatch/tools/", "")).toBeNull();
    expect(rootDispatchRedirect("/dispatch/tools/tool-123", "")).toBeNull();
    expect(rootDispatchRedirect("/dispatch/tools/tool-123/", "")).toBeNull();
    expect(rootDispatchRedirect("/dispatch/apps/analytics", "")).toBeNull();
    expect(rootDispatchRedirect("/dispatch/apps/analytics/", "")).toBeNull();
  });

  it("allows React Router manifest patch requests through the mounted dispatch path", () => {
    useDispatchBasePath();

    expect(
      rootDispatchRedirect(
        "/dispatch/__manifest",
        "?paths=%2Fdispatch%2Foverview",
      ),
    ).toBeNull();
    expect(
      rootDispatchRedirect("/__manifest", "?paths=%2Fdispatch%2Foverview"),
    ).toBeNull();
  });

  it("still redirects root dispatch aliases to the mounted overview route", () => {
    useDispatchBasePath();

    const response = rootDispatchRedirect("/apps", "?tab=all");

    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe("/dispatch/apps?tab=all");
  });

  it("redirects root app detail aliases to mounted Dispatch app details", () => {
    useDispatchBasePath();

    const response = rootDispatchRedirect("/apps/analytics", "?tab=activity");

    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe(
      "/dispatch/apps/analytics?tab=activity",
    );
  });

  it("redirects embedded root aliases to mounted Dispatch routes", () => {
    useDispatchBasePath();

    const approval = rootDispatchRedirect("/approval", "?id=req-1");
    const tools = rootDispatchRedirect("/tools", "");
    const toolsTrailingSlash = rootDispatchRedirect("/tools/", "");

    expect(approval?.status).toBe(302);
    expect(approval?.headers.get("location")).toBe(
      "/dispatch/approval?id=req-1",
    );
    expect(tools?.status).toBe(302);
    expect(tools?.headers.get("location")).toBe("/dispatch/tools");
    expect(toolsTrailingSlash?.status).toBe(302);
    expect(toolsTrailingSlash?.headers.get("location")).toBe("/dispatch/tools");
  });

  it("redirects the mounted app-creation alias to the actual route", () => {
    useDispatchBasePath();

    const response = rootDispatchRedirect(
      "/dispatch/apps/new-app/",
      "?from=apps",
    );

    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe(
      "/dispatch/new-app?from=apps",
    );
  });
});
