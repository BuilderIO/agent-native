import type { compareAndSetClientAppState } from "@agent-native/core/client/application-state";
import type { DocumentFlushRequest } from "@shared/document-flush-protocol";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  createDocumentFlushParticipant,
  createFlushObservedRef,
  type FlushLocalSnapshot,
} from "./document-flush-participant";

const identity = { clientId: 123, editorSessionId: "mounted-editor" };
let request: DocumentFlushRequest;
let local: FlushLocalSnapshot;
let compare: Mock<typeof compareAndSetClientAppState>;
let read: ReturnType<typeof vi.fn>;
let drain: Mock<(propertyId?: string) => Promise<void>>;
function participant() {
  return createDocumentFlushParticipant({
    identity: () => identity,
    documentId: () => "doc",
    snapshot: () => ({ ...local }),
    drain,
    read: read as any,
    compare,
  });
}
const acks = () =>
  compare.mock.calls
    .filter(([, expected, next]) => expected === null && next !== null)
    .map((call) => call[2]!);

describe("fresh document flush participant", () => {
  beforeEach(() => {
    request = {
      protocol: 2,
      id: "doc",
      requestId: "request",
      phase: "prepare",
      phaseToken: "prepare",
      prepareToken: "prepare",
      expiresAt: Date.now() + 4000,
      targets: [identity],
    };
    local = {
      identity: identity.editorSessionId,
      generation: 0,
      observation: 0,
      valueEpoch: 0,
      visualVersion: null,
      title: "Title",
      content: "Body",
      clean: true,
      claim: {
        kind: "document",
        save: { revision: "r1", title: "Title", titleUpdatedAt: null },
      },
    };
    compare = vi
      .fn<typeof compareAndSetClientAppState>()
      .mockResolvedValue(true);
    read = vi.fn(async () => request);
    drain = vi
      .fn<(propertyId?: string) => Promise<void>>()
      .mockResolvedValue(undefined);
  });
  it("does not confirm a remote observation arriving across the save await", async () => {
    let release!: () => void;
    drain.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const pending = participant()(request);
    local.observation++;
    local.content = "Peer observation";
    release();
    await pending;
    expect(acks()).toHaveLength(1);
    expect(acks()[0].status).toBe("changed");
  });
  it("does not confirm an authored edit arriving across the save await", async () => {
    drain.mockImplementation(async () => {
      local.generation++;
      local.content = "New input";
    });
    await participant()(request);
    expect(acks()[0].status).toBe("changed");
  });
  it("refuses body and title changes even when no generation counter advances", async () => {
    drain.mockImplementation(async () => {
      local.content = "Changed in the same generation";
      local.title = "Changed title";
    });
    await participant()(request);
    expect(acks()[0].status).toBe("changed");
  });
  it("invalidates a same-generation value change even when it changes back before verification", async () => {
    const observed = createFlushObservedRef(local.content, () => {
      local.valueEpoch += 1;
    });
    const respond = participant();
    await respond(request);
    observed.current = "Temporary reconciliation";
    observed.current = local.content;
    request = { ...request, phase: "verify", phaseToken: "after-S" };
    await respond(request);
    expect(acks()[1].status).toBe("changed");
  });
  it("refuses a still-pending or recovery snapshot after drain", async () => {
    local.clean = false;
    await participant()(request);
    expect(acks()[0]).toMatchObject({
      status: "error",
      errorCode: "editor_save_unsettled",
    });
  });
  it("only verifies the unchanged interval that spans SQL capture", async () => {
    const respond = participant();
    await respond(request);
    const prepared = acks()[0];
    request = { ...request, phase: "verify", phaseToken: "after-S" };
    await respond(request);
    expect(acks()[1]).toMatchObject({
      status: "verified",
      stabilityToken: prepared.stabilityToken,
    });
  });
  it("refuses a post-prepare edit even when it saves again before verification", async () => {
    const respond = participant();
    await respond(request);
    local.generation++;
    local.content = "New saved text";
    request = { ...request, phase: "verify", phaseToken: "after-S" };
    await respond(request);
    expect(acks()[1].status).toBe("changed");
  });
  it("refuses a stale prepare token in verification", async () => {
    const respond = participant();
    await respond(request);
    request = {
      ...request,
      phase: "verify",
      phaseToken: "after-S",
      prepareToken: "old-prepare",
    };
    await respond(request);
    expect(acks()[1].status).toBe("changed");
  });
  it("deduplicates a successfully published phase without replacing its stability token", async () => {
    const respond = participant();
    await respond(request);
    await respond(request);
    expect(drain).toHaveBeenCalledOnce();
    expect(acks()).toHaveLength(1);
  });
  it("removes only its own late ACK if a successor replaces the mailbox during publication", async () => {
    compare.mockImplementation(async () => {
      request = { ...request, requestId: "successor" };
      return true;
    });
    const original = request;
    await participant()(original);
    expect(compare.mock.calls[compare.mock.calls.length - 1]).toEqual([
      expect.stringContaining("request-prepare-123"),
      expect.objectContaining({ requestId: "request", status: "prepared" }),
      null,
      expect.anything(),
    ]);
  });
  it("makes a refused ACK CAS visible and cannot publish a verified result", async () => {
    compare.mockResolvedValue(false);
    read.mockImplementation(async (key) =>
      key.startsWith("flush-ack-") ? null : request,
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await participant()(request);
    expect(error).toHaveBeenCalledWith(
      "Document flush acknowledgment failed",
      expect.anything(),
    );
    expect(compare).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
  it("does not publish to an expired, unrelated, or remounted identity", async () => {
    const respond = participant();
    await respond({ ...request, expiresAt: Date.now() - 1 });
    await respond({ ...request, targets: [{ ...identity, clientId: 456 }] });
    await respond({
      ...request,
      targets: [{ ...identity, editorSessionId: "other-mount" }],
    });
    expect(compare).not.toHaveBeenCalled();
  });
});
