import { describe, expect, it } from "vitest";

import {
  DEFAULT_CHECKPOINT_KEEP,
  selectCheckpointsToPrune,
  type PrunableCheckpointRow,
} from "./checkpoint-pruning";
import { parseCheckpointSnapshotFiles } from "./design-checkpoint";

function row(
  id: string,
  kind: string | null,
  createdAt: string | null,
): PrunableCheckpointRow {
  return { id, kind, createdAt };
}

describe("selectCheckpointsToPrune", () => {
  it("keeps everything when at or under the retention limit", () => {
    const rows = [
      row("a", "pre-agent-run", "2026-01-01T00:00:00Z"),
      row("b", "pre-agent-run", "2026-01-02T00:00:00Z"),
    ];
    expect(selectCheckpointsToPrune(rows, "pre-agent-run", 20)).toEqual([]);
  });

  it("prunes the oldest rows of the kind beyond the newest N", () => {
    const rows = [
      row("old", "pre-agent-run", "2026-01-01T00:00:00Z"),
      row("mid", "pre-agent-run", "2026-01-02T00:00:00Z"),
      row("new", "pre-agent-run", "2026-01-03T00:00:00Z"),
    ];
    // keep newest 1 -> the two older ones are pruned
    expect(selectCheckpointsToPrune(rows, "pre-agent-run", 1).sort()).toEqual([
      "mid",
      "old",
    ]);
  });

  it("never prunes rows of a different kind", () => {
    const rows = [
      row("manual1", "manual", "2026-01-01T00:00:00Z"),
      row("manual2", "manual", "2026-01-02T00:00:00Z"),
      row("auto1", "pre-agent-run", "2026-01-01T00:00:00Z"),
      row("auto2", "pre-agent-run", "2026-01-02T00:00:00Z"),
    ];
    expect(selectCheckpointsToPrune(rows, "pre-agent-run", 1)).toEqual([
      "auto1",
    ]);
  });

  it("never prunes null-kind rows", () => {
    const rows = [
      row("legacy1", null, "2026-01-01T00:00:00Z"),
      row("legacy2", null, "2026-01-02T00:00:00Z"),
    ];
    expect(selectCheckpointsToPrune(rows, "pre-agent-run", 0)).toEqual([]);
  });

  it("breaks timestamp ties deterministically by id (keeps higher id)", () => {
    const rows = [
      row("a", "pre-agent-run", "2026-01-01T00:00:00Z"),
      row("b", "pre-agent-run", "2026-01-01T00:00:00Z"),
      row("c", "pre-agent-run", "2026-01-01T00:00:00Z"),
    ];
    // keep newest 1 -> "c" survives (highest id), a & b pruned
    expect(selectCheckpointsToPrune(rows, "pre-agent-run", 1).sort()).toEqual([
      "a",
      "b",
    ]);
  });

  it("treats a negative keep as zero (prunes all of the kind)", () => {
    const rows = [row("a", "pre-agent-run", "2026-01-01T00:00:00Z")];
    expect(selectCheckpointsToPrune(rows, "pre-agent-run", -5)).toEqual(["a"]);
  });

  it("exposes a sane default retention", () => {
    expect(DEFAULT_CHECKPOINT_KEEP).toBeGreaterThan(0);
  });
});

describe("parseCheckpointSnapshotFiles", () => {
  it("extracts valid file entries from a snapshot", () => {
    const snapshot = JSON.stringify({
      designId: "d1",
      files: [
        { id: "f1", filename: "a.html", content: "<a>", fileType: "html" },
        { id: "f2", filename: "b.html", content: "<b>" },
      ],
    });
    const files = parseCheckpointSnapshotFiles(snapshot);
    expect(files.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(files[0].content).toBe("<a>");
  });

  it("drops malformed entries (missing id/content/filename)", () => {
    const snapshot = JSON.stringify({
      files: [
        { id: "ok", filename: "a.html", content: "x" },
        { id: "no-content", filename: "b.html" },
        { filename: "no-id.html", content: "y" },
        null,
        "nope",
      ],
    });
    expect(parseCheckpointSnapshotFiles(snapshot).map((f) => f.id)).toEqual([
      "ok",
    ]);
  });

  it("returns [] for invalid or fileless JSON", () => {
    expect(parseCheckpointSnapshotFiles("not json")).toEqual([]);
    expect(parseCheckpointSnapshotFiles(JSON.stringify({}))).toEqual([]);
    expect(parseCheckpointSnapshotFiles(JSON.stringify({ files: 5 }))).toEqual(
      [],
    );
  });
});
