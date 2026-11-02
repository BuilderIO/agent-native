import { describe, expect, it } from "vitest";

import {
  diagnosticSavePayload,
  finalizeDiagnosticJournal,
  pruneExpiredDiagnosticOutbox,
  putDiagnosticOutboxEntry,
  sameDiagnosticIdentity,
  type DiagnosticOutboxEntry,
} from "./diagnostic-outbox";

function entry(captureId = "capture"): DiagnosticOutboxEntry {
  return {
    captureId,
    captureAuthorization: "fake-capture-authorization",
    recordingId: "recording",
    origin: "https://clips.example.com",
    identity: { ownerEmail: "alice@example.com", orgId: "workspace" },
    activity: {
      app: "design",
      build: "test",
      coverage: [],
      dropped: 0,
      events: [],
      watched: {},
      pending: [],
      recordingStartedAtMs: 1_000_000,
      requestedWindow: { fromMs: 970_000, toMs: 1_100_000 },
      collectionStatus: "unsupported",
    },
    pauses: [],
    finalized: true,
    saved: "pending",
  };
}

describe("diagnostic outbox", () => {
  it("expires stale captures without blocking newer captures", () => {
    const stale = entry();
    stale.activity.recordingStartedAtMs = 1;
    const fresh = entry("fresh");
    const now = 31 * 24 * 60 * 60_000;
    fresh.activity.recordingStartedAtMs = now - 1_000;

    expect(pruneExpiredDiagnosticOutbox([stale, fresh], now)).toEqual([fresh]);
  });
  it("retries the same frozen capture bytes with its original recording and replaces its own journal", () => {
    const saved = entry();
    const persisted = JSON.parse(
      JSON.stringify(putDiagnosticOutboxEntry([], saved)),
    ) as DiagnosticOutboxEntry[];
    if (!persisted[0]) throw new Error("missing recovered capture");
    expect(diagnosticSavePayload(persisted[0])).toEqual(
      diagnosticSavePayload(saved),
    );
    expect(
      putDiagnosticOutboxEntry(persisted, {
        ...saved,
        saved: "failed",
        failureCode: "upload-failed",
      }),
    ).toHaveLength(1);
    expect(
      diagnosticSavePayload({
        ...saved,
        saved: "failed",
        failureCode: "upload-failed",
      }),
    ).toEqual(diagnosticSavePayload(saved));
  });

  it("refuses quota overflow while leaving the original pending evidence intact", () => {
    const existing = Array.from({ length: 8 }, (_, index) =>
      entry(`capture-${index}`),
    );
    expect(() => putDiagnosticOutboxEntry(existing, entry("extra"))).toThrow(
      "diagnostic-outbox-quota-exceeded",
    );
    expect(existing).toHaveLength(8);
  });

  it("binds upload recovery to both the collecting account and organization", () => {
    const identity = entry().identity;
    expect(
      sameDiagnosticIdentity(identity, {
        ...identity,
        ownerEmail: "ALICE@example.com",
      }),
    ).toBe(true);
    expect(
      sameDiagnosticIdentity(identity, {
        ...identity,
        ownerEmail: "bob@example.com",
      }),
    ).toBe(false);
    expect(
      sameDiagnosticIdentity(identity, {
        ...identity,
        orgId: "other-workspace",
      }),
    ).toBe(false);
    expect(() =>
      diagnosticSavePayload({ ...entry(), finalized: false }),
    ).toThrow("diagnostic-capture-not-finalized");
  });
  it("seals an interrupted web journal to its original recording and retries its frozen payload after restart", () => {
    const pending = entry();
    pending.finalized = false;
    pending.recorderTabId = 42;
    pending.activity.sources = [
      { documentId: "source-document", app: "design", build: "test" },
    ];
    pending.activity.events = [
      {
        documentId: "source-document",
        seq: 111,
        type: "action",
        name: "update-file",
        timestampMs: 1_010_000,
        elapsedMs: 10_000,
      },
    ];
    const recovered = JSON.parse(
      JSON.stringify(putDiagnosticOutboxEntry([], pending)),
    ) as DiagnosticOutboxEntry[];
    const journal = recovered.find(
      (item) => item.captureId === pending.captureId,
    );
    if (!journal) throw new Error("missing web journal");
    const finalized = finalizeDiagnosticJournal(journal, {
      stoppedAtMs: 1_120_000,
      failureCode: "recording-interrupted",
    });
    expect(finalized.recordingId).toBe(pending.recordingId);
    expect(finalized.captureId).toBe(pending.captureId);
    expect(finalized.activity.events).toEqual(pending.activity.events);
    expect(finalized.activity.gaps).toContainEqual({
      fromMs: 1_100_000,
      toMs: 1_120_000,
      reason: "recording-interrupted",
    });
    expect(diagnosticSavePayload(finalized)).toMatchObject({
      recordingId: pending.recordingId,
      captureId: pending.captureId,
      captured: "partial",
      failureCode: "recording-interrupted",
    });
    expect(
      finalizeDiagnosticJournal(finalized, { stoppedAtMs: 1_200_000 }),
    ).toEqual(finalized);
    expect(
      diagnosticSavePayload(JSON.parse(JSON.stringify(finalized))),
    ).toEqual(diagnosticSavePayload(finalized));
  });

  it("refuses to overwrite an acknowledged capture version with different recovered bytes", () => {
    const frozen = entry();
    const changed = structuredClone(frozen);
    changed.activity.events = [
      {
        type: "error",
        name: "different-evidence",
        timestampMs: 1_020_000,
        elapsedMs: 20_000,
      },
    ];
    expect(() => putDiagnosticOutboxEntry([frozen], changed)).toThrow(
      "diagnostic-capture-already-finalized",
    );
    expect(() =>
      putDiagnosticOutboxEntry([frozen], { ...frozen, finalized: false }),
    ).toThrow("diagnostic-capture-already-finalized");
    expect(frozen.activity.events).toEqual([]);
  });
});
