import { describe, expect, it } from "vitest";

import {
  canViewWhileRedacting,
  countPendingRedactions,
  isHeldForRedaction,
} from "./pending-redactions";

const withRedaction = JSON.stringify({
  version: 1,
  trims: [],
  blurs: [],
  overlays: [
    {
      id: "redact-1",
      kind: "redact",
      style: "mosaic",
      startMs: 0,
      endMs: 1_000,
      keys: [{ atMs: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
    },
  ],
});
const clean = JSON.stringify({ version: 1, trims: [], blurs: [] });

describe("holding a clip back while it is being redacted", () => {
  it("counts the boxes still waiting", () => {
    expect(countPendingRedactions(withRedaction)).toBe(1);
    expect(countPendingRedactions(clean)).toBe(0);
    expect(countPendingRedactions(null)).toBe(0);
  });

  it("holds it from a viewer, a commenter and a stranger", () => {
    for (const role of ["viewer", "commenter", null, undefined, ""]) {
      expect(isHeldForRedaction(withRedaction, role), String(role)).toBe(true);
    }
  });

  it("lets the people who can finish the job carry on watching", () => {
    for (const role of ["owner", "admin", "editor"]) {
      expect(canViewWhileRedacting(role), role).toBe(true);
      expect(isHeldForRedaction(withRedaction, role), role).toBe(false);
    }
  });

  it("holds nothing back once the boxes are burned in", () => {
    expect(isHeldForRedaction(clean, "viewer")).toBe(false);
  });

  it("holds a recording whose edits cannot be read", () => {
    // They parse as the defaults, which would read as nothing pending.
    expect(isHeldForRedaction("{not json", "viewer")).toBe(true);
    expect(isHeldForRedaction("{not json", "owner")).toBe(false);
    // Valid JSON that is not an edits object is just as unreadable.
    expect(isHeldForRedaction("null", "viewer")).toBe(true);
    expect(isHeldForRedaction("[]", "viewer")).toBe(true);
  });
});
