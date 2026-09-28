import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { H3Event } from "h3";
import { describe, expect, it } from "vitest";

import {
  BUILDER_UPSTREAM_FAILURE_STATUS,
  cdnSafeOriginStatus,
  sendBuilderPopupErrorPage,
} from "./builder-browser.js";

function createMockEvent(): H3Event & {
  res: { status: number; headers: Headers };
} {
  return { res: { status: 200, headers: new Headers() } } as never;
}

describe("cdnSafeOriginStatus", () => {
  it("rewrites gateway statuses a CDN would swallow", () => {
    expect(cdnSafeOriginStatus(502)).toBe(503);
    expect(cdnSafeOriginStatus(504)).toBe(503);
  });

  it("leaves every other status alone", () => {
    for (const status of [200, 400, 401, 403, 409, 500, 503]) {
      expect(cdnSafeOriginStatus(status)).toBe(status);
    }
  });
});

describe("sendBuilderPopupErrorPage", () => {
  it("serves the real reason and the opener handoff when provisioning fails", () => {
    const event = createMockEvent();
    const html = sendBuilderPopupErrorPage(
      event,
      502,
      "Couldn't create your Builder account. Try again or connect an existing account.",
      { parentOrigin: "https://beta.brain.agent-native.com", code: "x" },
    );

    expect(event.res.status).toBe(BUILDER_UPSTREAM_FAILURE_STATUS);
    expect(event.res.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(html).toContain("Couldn't create your Builder account.");
    expect(html).toContain("builder-connect-error");
  });

  it("preserves a caller status the CDN passes through", () => {
    const event = createMockEvent();
    sendBuilderPopupErrorPage(event, 403, "Verify your email first.");
    expect(event.res.status).toBe(403);
  });
});

describe("builder connect route statuses", () => {
  it("never answers a Builder route with a gateway status", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./core-routes-plugin.ts", import.meta.url)),
      "utf-8",
    );
    const code = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/(?<![\w.])50[24](?![\w.])/);
  });
});
