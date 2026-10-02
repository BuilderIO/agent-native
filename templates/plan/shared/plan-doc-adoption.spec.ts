import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { PlanBlock } from "./plan-content";
import { adoptSnapshot, documentIsAheadOfSaved } from "./plan-doc-adoption";

const prose = (id: string, markdown: string) =>
  ({ id, type: "rich-text", data: { markdown } }) as PlanBlock;
const callout = (id: string, body: string) =>
  ({ id, type: "callout", data: { tone: "info", body } }) as PlanBlock;

describe("adoptSnapshot", () => {
  const base = [prose("a", "Alpha."), callout("c", "Note.")];

  it("keeps typing a collaborator's lagging save predates", () => {
    // The live document merged both people's typing; the other writer's save
    // holds only their own.
    const live = [prose("a", "Alpha. mine theirs"), base[1]];
    const snapshot = [prose("a", "Alpha. theirs"), base[1]];
    const adopted = adoptSnapshot(base, live, snapshot);
    expect(adopted.target).toEqual(live);
    expect(adopted.keptLiveEdits).toBe(true);
  });

  it("adopts a block that changed outside the document without touching typing", () => {
    const live = [prose("a", "Alpha. mine"), base[1]];
    const snapshot = [
      prose("a", "Alpha."),
      callout("c", "Changed by an agent."),
    ];
    const adopted = adoptSnapshot(base, live, snapshot);
    expect(adopted.target).toEqual([
      prose("a", "Alpha. mine"),
      callout("c", "Changed by an agent."),
    ]);
    expect(adopted.keptLiveEdits).toBe(true);
  });

  it("reports nothing kept when the document already matches the snapshot", () => {
    const snapshot = [prose("a", "Alpha. theirs"), base[1]];
    const adopted = adoptSnapshot(base, snapshot, snapshot);
    expect(adopted.target).toEqual(snapshot);
    expect(adopted.keptLiveEdits).toBe(false);
  });

  it("falls back to the snapshot when the edits overlap", () => {
    const live = [prose("a", "Alpha."), callout("c", "Mine.")];
    const snapshot = [prose("a", "Alpha."), callout("c", "Theirs.")];
    const adopted = adoptSnapshot(base, live, snapshot);
    expect(adopted.target).toEqual(snapshot);
    expect(adopted.keptLiveEdits).toBe(false);
  });
});

describe("documentIsAheadOfSaved", () => {
  it("is false when only a field the editor does not write differs", () => {
    const saved = [{ ...prose("a", "Alpha."), editable: true } as PlanBlock];
    expect(documentIsAheadOfSaved([prose("a", "Alpha.")], saved)).toBe(false);
  });

  it("is true when the document holds text the saved copy lacks", () => {
    expect(
      documentIsAheadOfSaved(
        [prose("a", "Alpha. theirs mine")],
        [prose("a", "Alpha. theirs")],
      ),
    ).toBe(true);
  });
});

describe("Plan document editor wiring", () => {
  const source = readFileSync(
    join(
      import.meta.dirname,
      "..",
      "app",
      "components",
      "editor",
      "PlanDocumentEditor.tsx",
    ),
    "utf8",
  );

  it("merges incoming snapshots into the document and saves what collaborators' typing left unsaved", () => {
    expect(source).toContain("adoptSnapshot(");
    expect(source).toContain("onRemoteSnapshotChange={handleRemoteDocChange}");
  });
});
