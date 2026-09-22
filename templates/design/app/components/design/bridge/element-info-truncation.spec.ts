import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The bridge caps `textContent` and `htmlContent` before they are persisted to
 * `design-selection` and relayed verbatim by the `view-screen` action. The
 * matching `*Truncated` flag is the only thing separating "this is the whole
 * text" from "this is a prefix" — and `apply-visual-edit` kind:"textContent"
 * replaces an element's ENTIRE text, so an agent that writes an unflagged
 * preview back deletes everything past the cap.
 *
 * The cap and its flag are written as two separate literals inside an injected
 * IIFE that cannot import a shared constant, so this asserts they agree.
 */
const BRIDGE = readFileSync(
  path.join(__dirname, "editor-chrome.bridge.ts"),
  "utf8",
);

describe("editor-chrome bridge element previews", () => {
  it("pairs every textContent/innerHTML cap with a flag at the same limit", () => {
    const caps = [
      ...BRIDGE.matchAll(/el\.(textContent|innerHTML)\.slice\(0,\s*(\d+)\)/g),
    ].map(([, field, limit]) => `${field}:${limit}`);

    const flags = [
      ...BRIDGE.matchAll(/el\.(textContent|innerHTML)\.length > (\d+)/g),
    ].map(([, field, limit]) => `${field}:${limit}`);

    expect(caps.length).toBeGreaterThan(0);
    for (const cap of new Set(caps)) {
      expect(flags, `capped ${cap} with no matching truncation flag`).toContain(
        cap,
      );
    }
  });
});
