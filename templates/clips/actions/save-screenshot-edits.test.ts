import { describe, expect, it } from "vitest";

import { countPendingRedactions } from "../server/lib/pending-redactions";
import { nextScreenshotEdits } from "./save-screenshot-edits";

const pending = {
  id: "r1",
  kind: "redact",
  style: "mosaic",
  startMs: 0,
  endMs: 1,
  keys: [{ atMs: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
};
const region = { x: 10, y: 10, width: 20, height: 20 };

describe("nextScreenshotEdits", () => {
  it("keeps placed redactions pending, which holds the screenshot", () => {
    const edits = nextScreenshotEdits("{}", {
      burning: false,
      annotations: [],
      pendingRedactions: [pending],
      burnedRegions: [],
    });
    expect(countPendingRedactions(JSON.stringify(edits))).toBe(1);
    expect((edits as any).redactions).toBeUndefined();
  });

  it("clears the pending list on a burn and records what was burned", () => {
    const before = JSON.stringify({
      overlays: [pending],
      redactions: [region],
    });
    const edits = nextScreenshotEdits(before, {
      burning: true,
      annotations: [],
      // Even if the client still sends some, a burn burns everything.
      pendingRedactions: [pending],
      burnedRegions: [region],
    });
    expect(countPendingRedactions(JSON.stringify(edits))).toBe(0);
    expect((edits as any).redactions).toEqual([region, region]);
  });

  it("drops a pending redaction the editor removed", () => {
    const edits = nextScreenshotEdits(JSON.stringify({ overlays: [pending] }), {
      burning: false,
      annotations: [],
      pendingRedactions: [],
      burnedRegions: [],
    });
    expect(countPendingRedactions(JSON.stringify(edits))).toBe(0);
  });

  it("ignores malformed redactions rather than storing them", () => {
    const edits = nextScreenshotEdits("{}", {
      burning: false,
      annotations: [],
      pendingRedactions: [{ kind: "redact", id: "bad" }],
      burnedRegions: [],
    });
    expect((edits as any).overlays).toEqual([]);
  });

  it("keeps overlay kinds it does not know about", () => {
    const other = { kind: "future-thing", id: "x" };
    const edits = nextScreenshotEdits(JSON.stringify({ overlays: [other] }), {
      burning: true,
      annotations: [],
      pendingRedactions: [],
      burnedRegions: [],
    });
    expect((edits as any).overlays).toEqual([other]);
  });

  it("stores a crop, keeps it when not sent, and removes it on null", () => {
    const base = {
      burning: false,
      annotations: [],
      pendingRedactions: [],
      burnedRegions: [],
    };
    const crop = { x: 10, y: 20, width: 300, height: 200 };
    const cropped = nextScreenshotEdits("{}", { ...base, crop });
    expect((cropped as any).crop).toEqual(crop);
    const kept = nextScreenshotEdits(JSON.stringify(cropped), base);
    expect((kept as any).crop).toEqual(crop);
    const removed = nextScreenshotEdits(JSON.stringify(cropped), {
      ...base,
      crop: null,
    });
    expect((removed as any).crop).toBeUndefined();
  });
});
