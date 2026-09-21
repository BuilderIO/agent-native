import { readFileSync } from "node:fs";

import type { H3Event } from "h3";
import { describe, expect, it } from "vitest";

import {
  getPublicFrameworkPathname,
  PUBLIC_PATHNAME_CONTEXT_KEY,
} from "./framework-request-context.js";
import { getPublicFrameworkPathname as getPublicFrameworkPathnameFromHandler } from "./framework-request-handler.js";

function eventWithContext(context: Record<string, unknown>): H3Event {
  return { context } as H3Event;
}

describe("framework request context", () => {
  it("reads only string public pathnames", () => {
    expect(
      getPublicFrameworkPathname(
        eventWithContext({
          [PUBLIC_PATHNAME_CONTEXT_KEY]: "/mail/_platform/auth/callback",
        }),
      ),
    ).toBe("/mail/_platform/auth/callback");
    expect(getPublicFrameworkPathname(eventWithContext({}))).toBeUndefined();
    expect(
      getPublicFrameworkPathname(
        eventWithContext({ [PUBLIC_PATHNAME_CONTEXT_KEY]: 42 }),
      ),
    ).toBeUndefined();
  });

  it("keeps the request handler export compatible", () => {
    expect(getPublicFrameworkPathnameFromHandler).toBe(
      getPublicFrameworkPathname,
    );
  });

  it("keeps auth callers on the leaf module", () => {
    for (const file of ["auth.ts", "google-oauth.ts"]) {
      const source = readFileSync(
        new URL(`./${file}`, import.meta.url),
        "utf8",
      );
      expect(source).toContain(
        'getPublicFrameworkPathname } from "./framework-request-context.js"',
      );
      const handlerImports = Array.from(
        source.matchAll(
          /(?:^|\n)(import\s+[^;]+?\s+from\s+"\.\/framework-request-handler\.js";)/g,
        ),
        (match) => match[1].trim(),
      );
      expect(
        handlerImports.every((statement) => /^import\s+type\b/.test(statement)),
      ).toBe(true);
      expect(source).not.toContain('import("./framework-request-handler.js")');
    }
  });
});
