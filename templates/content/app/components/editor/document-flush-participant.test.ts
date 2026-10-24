import type { compareAndSetClientAppState } from "@agent-native/core/client/application-state";
import type { DocumentFlushRequest } from "@shared/document-flush-protocol";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import {
  createDocumentFlushParticipant,
  createFlushObservedRef,
  type FlushLocalSnapshot,
  type FlushTitleSave,
  type FlushTitleSnapshot,
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
  afterEach(() => vi.useRealTimers());
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
  it("waits for transient convergence without draining the same snapshot again", async () => {
    vi.useFakeTimers();
    local.clean = false;
    const pending = participant()(request);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(acks()).toHaveLength(0);
    expect(drain).toHaveBeenCalledOnce();
    local.clean = true;
    await vi.advanceTimersByTimeAsync(25);
    await pending;
    expect(acks()).toHaveLength(1);
    expect(acks()[0]).toHaveProperty("status", "prepared");
    expect(drain).toHaveBeenCalledOnce();
  });
  it("bounds a continuously unsettled snapshot by the original request deadline without an ACK", async () => {
    vi.useFakeTimers();
    request.expiresAt = Date.now() + 20_000;
    local.clean = false;
    const pending = participant()(request);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(acks()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(acks()).toHaveLength(0);
    expect(drain).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("publishes a typed refusal when drain actually fails", async () => {
    drain.mockRejectedValue(new Error("Persistence unavailable"));
    await participant()(request);
    expect(acks()).toHaveLength(1);
    expect(acks()[0]).toMatchObject({
      status: "error",
      errorCode: "editor_flush_failed",
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

describe("title flush participant", () => {
  let titleLocal: FlushTitleSnapshot;
  let save: Mock<() => Promise<FlushTitleSave>>;
  function titleParticipant(withTitle = true) {
    return createDocumentFlushParticipant({
      identity: () => identity,
      documentId: () => "doc",
      snapshot: () => ({ ...local }),
      drain,
      ...(withTitle
        ? { title: { snapshot: () => ({ ...titleLocal }), save } }
        : {}),
      read: read as any,
      compare,
    });
  }
  const writes = () =>
    compare.mock.calls.map(([, expected, next]) => ({
      expected: expected?.status ?? null,
      next: next?.status ?? null,
    }));
  const lastCall = () => compare.mock.calls[compare.mock.calls.length - 1]!;
  const last = () => lastCall()[2]!;

  afterEach(() => vi.useRealTimers());
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
      scope: "title",
    };
    // The body of a page whose body is its live copy can stay unsaved.
    local = {
      identity: identity.editorSessionId,
      generation: 0,
      observation: 0,
      valueEpoch: 0,
      visualVersion: null,
      title: "New title",
      content: "Unacknowledged body",
      clean: false,
      claim: null,
    };
    titleLocal = {
      identity: identity.editorSessionId,
      generation: 3,
      title: "New title",
    };
    compare = vi
      .fn<typeof compareAndSetClientAppState>()
      .mockResolvedValue(true);
    read = vi.fn(async () => request);
    drain = vi
      .fn<(propertyId?: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    save = vi
      .fn<() => Promise<FlushTitleSave>>()
      .mockImplementation(async () => ({
        status: "saved",
        title: titleLocal.title,
      }));
  });

  it("marks the request taken before it saves the title, then replaces the mark with the title it saved", async () => {
    let writesBeforeSave = -1;
    save.mockImplementation(async () => {
      writesBeforeSave = compare.mock.calls.length;
      return { status: "saved", title: "New title" };
    });
    await titleParticipant()(request);
    expect(writesBeforeSave).toBe(1);
    expect(writes()).toEqual([
      { expected: null, next: "taken" },
      { expected: "taken", next: "prepared" },
    ]);
    expect(compare.mock.calls[1]![1]).toEqual(compare.mock.calls[0]![2]);
    expect(last()).toMatchObject({
      status: "prepared",
      phase: "prepare",
      claim: { kind: "title", title: "New title" },
    });
  });

  it("answers without draining the body or waiting for it to save", async () => {
    await titleParticipant()(request);
    expect(drain).not.toHaveBeenCalled();
    expect(last()).toHaveProperty("status", "prepared");
  });

  it("refuses a title request when it can't save a title alone, without draining the body", async () => {
    await titleParticipant(false)(request);
    expect(drain).not.toHaveBeenCalled();
    expect(writes()).toEqual([{ expected: null, next: "error" }]);
    expect(last()).toHaveProperty("errorCode", "title_flush_unsupported");
  });

  it("answers a refused title save with its reason, in place of the taken mark", async () => {
    save.mockResolvedValue({ status: "refused", errorCode: "title_conflict" });
    await titleParticipant()(request);
    expect(writes()).toEqual([
      { expected: null, next: "taken" },
      { expected: "taken", next: "error" },
    ]);
    expect(last()).toHaveProperty("errorCode", "title_conflict");
  });

  it("answers a title save that throws with a typed error, in place of the taken mark", async () => {
    save.mockRejectedValue(new Error("Network down"));
    await titleParticipant()(request);
    expect(writes()).toEqual([
      { expected: null, next: "taken" },
      { expected: "taken", next: "error" },
    ]);
    expect(last()).toHaveProperty("errorCode", "editor_flush_failed");
  });

  it("answers changed when the title is edited while it saves", async () => {
    save.mockImplementation(async () => {
      const saved = titleLocal.title;
      titleLocal = { ...titleLocal, generation: 4, title: "Newer title" };
      return { status: "saved", title: saved };
    });
    await titleParticipant()(request);
    expect(writes()).toEqual([
      { expected: null, next: "taken" },
      { expected: "taken", next: "changed" },
    ]);
  });

  it("answers changed when a title edit is undone while it saves", async () => {
    save.mockImplementation(async () => {
      titleLocal = { ...titleLocal, generation: 5 };
      return { status: "saved", title: titleLocal.title };
    });
    await titleParticipant()(request);
    expect(last()).toHaveProperty("status", "changed");
  });

  it("answers changed when the title it saved isn't the one it holds", async () => {
    save.mockResolvedValue({ status: "saved", title: "Older title" });
    await titleParticipant()(request);
    expect(last()).toHaveProperty("status", "changed");
  });

  it("leaves only the taken mark when its save outlives the request", async () => {
    vi.useFakeTimers();
    save.mockImplementation(() => new Promise<FlushTitleSave>(() => {}));
    const pending = titleParticipant()(request);
    await vi.advanceTimersByTimeAsync(4_000);
    await pending;
    expect(writes()).toEqual([{ expected: null, next: "taken" }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("saves nothing when the request moves on as it marks it taken, and removes its mark", async () => {
    const original = request;
    compare.mockImplementation(async () => {
      request = { ...original, requestId: "successor" };
      return true;
    });
    await titleParticipant()(original);
    expect(save).not.toHaveBeenCalled();
    expect(writes()).toEqual([
      { expected: null, next: "taken" },
      { expected: "taken", next: null },
    ]);
  });

  it("saves nothing when another answer holds its key", async () => {
    compare.mockResolvedValue(false);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await titleParticipant()(request);
    expect(save).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "Document flush acknowledgment failed",
      expect.anything(),
    );
    error.mockRestore();
  });

  it("verifies the title it prepared while it stays unchanged, though the body changes", async () => {
    const respond = titleParticipant();
    await respond(request);
    const prepared = last();
    local = { ...local, generation: 9, content: "More unacknowledged body" };
    request = { ...request, phase: "verify", phaseToken: "after-S" };
    await respond(request);
    expect(last()).toMatchObject({
      status: "verified",
      phase: "verify",
      stabilityToken: prepared.stabilityToken,
    });
    expect(lastCall()[1]).toBeNull();
  });

  it("refuses to verify a title edited since it prepared", async () => {
    const respond = titleParticipant();
    await respond(request);
    titleLocal = { ...titleLocal, generation: 4, title: "Newer title" };
    request = { ...request, phase: "verify", phaseToken: "after-S" };
    await respond(request);
    expect(last()).toHaveProperty("status", "changed");
  });

  it("refuses to verify a stale prepare token, or a prepare that didn't answer prepared", async () => {
    const respond = titleParticipant();
    await respond(request);
    request = {
      ...request,
      phase: "verify",
      phaseToken: "after-S",
      prepareToken: "old-prepare",
    };
    await respond(request);
    expect(last()).toHaveProperty("status", "changed");

    save.mockResolvedValue({ status: "refused", errorCode: "title_conflict" });
    request = {
      ...request,
      phase: "prepare",
      phaseToken: "prepare-again",
      prepareToken: "prepare-again",
    };
    await respond(request);
    request = { ...request, phase: "verify", phaseToken: "after-S-again" };
    await respond(request);
    expect(last()).toHaveProperty("status", "changed");
  });

  it("doesn't take a title prepare as a whole flush's", async () => {
    const respond = titleParticipant();
    await respond(request);
    const { scope: _scope, ...whole } = request;
    local = {
      ...local,
      clean: true,
      claim: {
        kind: "document",
        save: { revision: "r1", title: "New title", titleUpdatedAt: null },
      },
    };
    request = { ...whole, phase: "verify", phaseToken: "after-S" };
    await respond(request);
    expect(last()).toHaveProperty("status", "changed");
  });

  it("answers each prepare round the server asks again", async () => {
    const respond = titleParticipant();
    await respond(request);
    request = {
      ...request,
      phaseToken: "prepare-again",
      prepareToken: "prepare-again",
    };
    await respond(request);
    expect(save).toHaveBeenCalledTimes(2);
    expect(writes()).toEqual([
      { expected: null, next: "taken" },
      { expected: "taken", next: "prepared" },
      { expected: null, next: "taken" },
      { expected: "taken", next: "prepared" },
    ]);
    expect(compare.mock.calls[2]![0]).toContain("prepare-again");
  });
});
