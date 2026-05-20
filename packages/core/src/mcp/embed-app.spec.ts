import { describe, expect, it } from "vitest";
import { embedApp, MCP_APP_REQUEST_ORIGIN_CSP_SOURCE } from "./embed-app.js";

describe("embedApp", () => {
  it("returns an MCP App resource that calls the embed session helper", () => {
    const resource = embedApp({
      title: "Dashboard",
      openLabel: "Open dashboard",
    });
    const html =
      typeof resource.html === "function"
        ? resource.html({ actionName: "open_app", appId: "analytics" })
        : resource.html;

    expect(html).toContain("create_embed_session");
    expect(html).toContain("app.callServerTool");
    expect(html).toContain('document.createElement("iframe")');
    expect(html).toContain(
      'toolInput.embed === false || toolInput.embed === "false"',
    );
    expect(html).toContain("min-height: 900px");
    expect(resource.csp?.frameDomains).toContain(
      MCP_APP_REQUEST_ORIGIN_CSP_SOURCE,
    );
    expect(resource.csp?.resourceDomains).toContain("https://esm.sh");
  });

  it("allows full-app embeds to request a 900px canvas", () => {
    const resource = embedApp({ height: 900 });
    const html =
      typeof resource.html === "function"
        ? resource.html({ actionName: "open_app", appId: "analytics" })
        : resource.html;

    expect(html).toContain("min-height: 900px");
    expect(html).toContain("height: 856px");
  });
});
