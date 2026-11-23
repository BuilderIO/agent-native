import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyAppLayout } from "../../../shared/app-layout.js";
import {
  notebookChangeSchema,
  notebookEventSchema,
  notebookSnapshotSchema,
  operationReceiptSchema,
  type NotebookCommand,
  type NotebookEvent,
  type NotebookSnapshot,
  type OperationReceipt,
} from "../../../shared/notebook-operations.js";
import { NotebookOperations } from "./notebook-write-queue.js";
import { warnBeforeNotebookUnload } from "./useNotebookOperations.js";

const projectId = "reconnect-project";
const workingVersionId = "working-v1";
const workspaceId = "test-workspace";
const accountId = "notebook-editor";
const at = "2026-11-18T00:00:00.000Z";

function document(
  cells: Record<string, [source: string, revision: string]>,
  revision = "0",
  eventSeq = revision,
  versionId = workingVersionId,
) {
  return notebookSnapshotSchema.parse({
    status: "accepted",
    snapshot: {
      workspaceId,
      projectId,
      head: { versionId, revision },
      eventSeq,
    },
    metadata: { title: "Notebook", description: "", statusId: null },
    resources: {
      orderRevision: "0",
      metadataRevision: "0",
      inputRevision: "0",
      layoutRevision: "0",
    },
    cells: Object.entries(cells).map(([id, [source, revision]], index) => ({
      id,
      projectId,
      versionId,
      createdAt: at,
      updatedAt: at,
      revision,
      labelRevision: "0",
      contents: {
        id,
        order: (index + 1).toString(36),
        label: null,
        hidden: false,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
        kind: "sql",
        source,
        dataConnectionId: null,
        databaseSchema: null,
        resultVariable: id,
        outputResult: true,
      },
    })),
  });
}

function edit(cellId: string, source: string, expectedRevision = "0") {
  return notebookChangeSchema.parse({
    type: "set-code",
    cellId,
    source,
    expectedRevision,
  });
}

function event(
  before: NotebookSnapshot,
  after: NotebookSnapshot,
  opId: string,
  changed: string[],
): NotebookEvent {
  return notebookEventSchema.parse({
    sequence: after.snapshot.eventSeq,
    principalId: accountId,
    before: {
      cells: before.cells.filter((cell) => changed.includes(cell.id)),
      tombstones: [],
      resources: before.resources,
    },
    invalidations: [],
    runIntent: null,
    receipt: {
      status: "applied",
      opId,
      previousHead: before.snapshot.head,
      nextHead: after.snapshot.head,
      eventSeq: after.snapshot.eventSeq,
      committedAt: at,
      delta: {
        cells: after.cells.filter((cell) => changed.includes(cell.id)),
        tombstones: [],
        resources: after.resources,
        ...(after.appLayout && after.appLayout !== before.appLayout
          ? { appLayout: after.appLayout }
          : {}),
      },
      impact: {
        opId,
        previousHead: before.snapshot.head,
        snapshot: after.snapshot,
        changedCellIds: changed,
        invalidatedOutputs: [],
      },
    },
  });
}

function source(snapshot: NotebookSnapshot | null, id = "sql_a") {
  const contents = snapshot?.cells.find((cell) => cell.id === id)?.contents;
  return contents?.kind === "sql" ? contents.source : undefined;
}

function hold<T>() {
  let deliver: (value: T) => void = () => {
    throw new Error("No pending response");
  };
  let drop: (error: Error) => void = () => {
    throw new Error("No pending response");
  };
  const response = new Promise<T>((resolve, reject) => {
    deliver = resolve;
    drop = reject;
  });
  return { response, deliver, drop };
}

const coordinators: NotebookOperations[] = [];

function fixture(initial = document({ sql_a: ["select 1", "0"] })) {
  let accepted = initial;
  let events: NotebookEvent[] = [];
  const transport = {
    apply: vi.fn(
      async (
        _command: NotebookCommand,
        _signal: AbortSignal,
      ): Promise<OperationReceipt> => {
        throw new Error("Unexpected send");
      },
    ),
    receipt: vi.fn<
      ConstructorParameters<typeof NotebookOperations>[1]["receipt"]
    >(async () => ({ status: "absent", reason: "not_found" })),
    changes: vi.fn<
      ConstructorParameters<typeof NotebookOperations>[1]["changes"]
    >(async ({ after }) => ({
      status: "ok",
      events: events.filter((entry) => BigInt(entry.sequence) > BigInt(after)),
      cursor: accepted.snapshot.eventSeq,
      hasMore: false,
    })),
    snapshot: vi.fn(async () => structuredClone(accepted)),
  };
  return {
    transport,
    commit(after: NotebookSnapshot, changed: string[], opId: string) {
      const entry = event(accepted, after, opId, changed);
      accepted = after;
      events.push(entry);
      return entry;
    },
    expire(after: NotebookSnapshot) {
      accepted = after;
      events = [];
      transport.changes.mockResolvedValueOnce({
        status: "expired",
        cursor: after.snapshot.eventSeq,
      });
    },
    open(base?: NotebookSnapshot, versionId = workingVersionId) {
      const coordinator = new NotebookOperations(
        { workspaceId, projectId, workingVersionId: versionId, accountId },
        transport,
        base,
      );
      coordinators.push(coordinator);
      return coordinator;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const coordinator of coordinators.splice(0)) coordinator.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("notebook operation reconnect", () => {
  it("reloads the previous durable text before commit and the new text after commit without an ack", async () => {
    const first = document({ sql_a: ["select 1", "0"] });
    const next = document({ sql_a: ["select 42", "1"] }, "1");
    const server = fixture(first);
    const held = hold<OperationReceipt>();
    server.transport.apply.mockReturnValueOnce(held.response);
    const original = server.open(first);
    const ticket = original.dispatch(edit("sql_a", "select 42"));
    void ticket.receipt.catch(() => undefined);
    expect(source(original.getSnapshot().effective)).toBe("select 42");
    expect(source(original.getSnapshot().accepted)).toBe("select 1");
    expect(original.getSnapshot().hasUnsavedChanges).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    expect(server.transport.apply).toHaveBeenCalledTimes(1);
    const reloadBeforeCommit = server.open();
    await reloadBeforeCommit.reconnect();
    expect(source(reloadBeforeCommit.getSnapshot().accepted)).toBe("select 1");
    expect(reloadBeforeCommit.getSnapshot().hasUnsavedChanges).toBe(false);

    server.commit(next, ["sql_a"], ticket.opId);
    original.dispose();
    const reloadAfterCommit = server.open();
    await reloadAfterCommit.reconnect();
    expect(source(reloadAfterCommit.getSnapshot().accepted)).toBe("select 42");
    expect(reloadAfterCommit.getSnapshot().hasUnsavedChanges).toBe(false);
    expect(server.transport.apply).toHaveBeenCalledTimes(1);
  });

  it("keeps disjoint tab edits and converges in both tabs on canonical receipts", async () => {
    const first = document({
      sql_a: ["select 1", "0"],
      sql_b: ["select 2", "0"],
    });
    const server = fixture(first);
    const tabA = server.open(first);
    const tabB = server.open(first);
    const [heldA, heldB] = [hold<OperationReceipt>(), hold<OperationReceipt>()];
    server.transport.apply
      .mockReturnValueOnce(heldA.response)
      .mockReturnValueOnce(heldB.response);

    const a = tabA.dispatch(edit("sql_a", "select 11"));
    const b = tabB.dispatch(edit("sql_b", "select 22"));
    await vi.advanceTimersByTimeAsync(500);
    expect(
      server.transport.apply.mock.calls.map(
        ([command]) => command.observedHead,
      ),
    ).toEqual([first.snapshot.head, first.snapshot.head]);

    const nextA = document(
      { sql_a: ["select 11", "1"], sql_b: ["select 2", "0"] },
      "1",
    );
    const nextB = document(
      { sql_a: ["select 11", "1"], sql_b: ["select 22", "2"] },
      "2",
    );
    const eventA = server.commit(nextA, ["sql_a"], a.opId);
    const eventB = server.commit(nextB, ["sql_b"], b.opId);
    heldB.deliver(eventB.receipt);
    await expect(b.receipt).resolves.toEqual(eventB.receipt);
    await tabA.receive(eventB);
    heldA.deliver(eventA.receipt);
    await expect(a.receipt).resolves.toEqual(eventA.receipt);
    await tabB.reconnect();
    expect(tabA.getSnapshot().accepted).toEqual(nextB);
    expect(tabB.getSnapshot().accepted).toEqual(nextB);
  });

  it("joins same-field conflicts to their intent and keeps the losing text in its tab", async () => {
    const first = document({ sql_a: ["select 1", "0"] });
    const winner = document({ sql_a: ["select 111", "1"] }, "1");
    const server = fixture(first);
    const tabA = server.open(first);
    const tabB = server.open(first);
    const [heldA, heldB] = [hold<OperationReceipt>(), hold<OperationReceipt>()];
    server.transport.apply
      .mockReturnValueOnce(heldA.response)
      .mockReturnValueOnce(heldB.response);

    const a = tabA.dispatch(edit("sql_a", "select 111"));
    const b = tabB.dispatch(edit("sql_a", "select 222"));
    await vi.advanceTimersByTimeAsync(500);
    const applied = server.commit(winner, ["sql_a"], a.opId);
    const conflict = operationReceiptSchema.parse({
      status: "conflict",
      opId: b.opId,
      reason: "cell_changed",
      previousHead: winner.snapshot.head,
      nextHead: winner.snapshot.head,
      eventSeq: winner.snapshot.eventSeq,
      committedAt: at,
    });
    heldA.deliver(applied.receipt);
    heldB.drop(
      Object.assign(new Error("Conflict"), {
        status: 409,
        errorCode: "notebook_conflict",
        details: { receipt: conflict },
      }),
    );
    await expect(a.receipt).resolves.toEqual(applied.receipt);
    await expect(b.receipt).resolves.toEqual(conflict);
    await tabB.reconnect();
    expect(source(tabA.getSnapshot().effective)).toBe("select 111");
    expect(source(tabB.getSnapshot().accepted)).toBe("select 111");
    expect(source(tabB.getSnapshot().effective)).toBe("select 222");
    expect(tabB.getSnapshot().hasUnsavedChanges).toBe(true);
    await expect(
      tabB.barrier({ type: "run", cellIds: ["sql_a"] }),
    ).rejects.toBeDefined();
  });

  it("reads a dropped event from the last cursor and rejects duplicate and stale deltas", async () => {
    const first = document(
      { sql_a: ["select 1", "0"] },
      "0",
      "9007199254740992",
    );
    const second = document(
      { sql_a: ["select 2", "1"] },
      "1",
      "9007199254740993",
    );
    const third = document(
      { sql_a: ["select 3", "2"] },
      "2",
      "9007199254740994",
    );
    const server = fixture(first);
    const tab = server.open(first);
    const dropped = server.commit(second, ["sql_a"], "peer-1");
    const delivered = server.commit(third, ["sql_a"], "peer-2");

    await tab.receive(delivered);
    expect(server.transport.changes).toHaveBeenCalledTimes(1);
    expect(server.transport.changes).toHaveBeenCalledWith(
      expect.objectContaining({
        after: first.snapshot.eventSeq,
      }),
      expect.any(AbortSignal),
    );
    await tab.receive(delivered);
    await tab.receive(dropped);
    expect(server.transport.changes).toHaveBeenCalledTimes(1);
    expect(tab.getSnapshot().accepted).toEqual(third);
  });

  it("uses a consistent snapshot on cursor expiry and ignores events older than it", async () => {
    const first = document({ sql_a: ["select 1", "0"] });
    const earlier = document({ sql_a: ["select 2", "1"] }, "1");
    const latest = document({ sql_a: ["select 42", "17"] }, "17");
    const server = fixture(first);
    const tab = server.open(first);
    const stale = server.commit(earlier, ["sql_a"], "peer-old");
    server.expire(latest);

    await tab.reconnect();
    expect(server.transport.snapshot).toHaveBeenCalledTimes(1);
    await tab.receive(stale);
    expect(tab.getSnapshot().accepted).toEqual(latest);
  });

  it("keeps a layout received from the journal across subsequent cell edits", async () => {
    const first = document({ sql_a: ["select 1", "0"] });
    const layoutRevision =
      notebookSnapshotSchema.shape.resources.shape.layoutRevision.parse("1");
    const appLayout = { ...emptyAppLayout(layoutRevision), initialized: true };
    const afterLayout = {
      ...document({ sql_a: ["select 1", "0"] }, "1"),
      resources: { ...first.resources, layoutRevision },
      appLayout,
    };
    const afterEdit = {
      ...document({ sql_a: ["select 2", "2"] }, "2"),
      resources: afterLayout.resources,
      appLayout,
    };
    const server = fixture(first);
    const tab = server.open(first);
    server.commit(afterLayout, [], "set-app");
    server.commit(afterEdit, ["sql_a"], "set-code");

    await tab.reconnect();

    expect(tab.getSnapshot().accepted).toEqual(afterEdit);
  });

  it("recovers the exact lost acknowledgement without replacing a newer accepted edit", async () => {
    const first = document({ sql_a: ["select 1", "0"] });
    const own = document({ sql_a: ["select 2", "1"] }, "1");
    const later = document({ sql_a: ["select 42", "2"] }, "2");
    const server = fixture(first);
    const tab = server.open(first);
    let committed: NotebookEvent | undefined;
    server.transport.apply.mockImplementationOnce(async (command) => {
      committed = server.commit(own, ["sql_a"], command.opId);
      server.commit(later, ["sql_a"], "peer-after-commit");
      throw new Error("Connection lost after commit");
    });
    server.transport.receipt.mockImplementation(async () => {
      if (!committed) throw new Error("Missing committed receipt");
      return { status: "found", receipt: committed.receipt };
    });

    const ticket = tab.dispatch(edit("sql_a", "select 2"));
    void ticket.receipt.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(850);
    await tab.reconnect();
    await expect(ticket.receipt).resolves.toEqual(committed?.receipt);
    expect(server.transport.receipt).toHaveBeenCalledWith(
      { projectId, opId: ticket.opId },
      expect.any(AbortSignal),
    );
    expect(server.transport.apply).toHaveBeenCalledTimes(1);
    expect(tab.getSnapshot().accepted).toEqual(later);
    expect(tab.getSnapshot().hasUnsavedChanges).toBe(false);
  });

  it("flushes the run watermark without waiting for an unrelated edit and waits for it at the full barrier", async () => {
    const first = document({
      sql_a: ["select 1", "0"],
      sql_b: ["select 2", "0"],
    });
    const server = fixture(first);
    const tab = server.open(first);
    const [heldRun, heldOther] = [
      hold<OperationReceipt>(),
      hold<OperationReceipt>(),
    ];
    server.transport.apply
      .mockReturnValueOnce(heldRun.response)
      .mockReturnValueOnce(heldOther.response);

    const runEdit = tab.dispatch(edit("sql_a", "select 11"));
    const otherEdit = tab.dispatch(edit("sql_b", "select 22"));
    const run = tab.barrier({ type: "run", cellIds: ["sql_a"] });
    const onRun = vi.fn();
    void run.then(onRun).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(server.transport.apply).toHaveBeenCalledTimes(1);
    const full = tab.barrier({ type: "full" });
    const onFull = vi.fn();
    void full.then(onFull).catch(() => undefined);

    const runReady = document(
      { sql_a: ["select 11", "1"], sql_b: ["select 2", "0"] },
      "1",
    );
    heldRun.deliver(server.commit(runReady, ["sql_a"], runEdit.opId).receipt);
    await vi.advanceTimersByTimeAsync(0);
    expect(onRun).toHaveBeenCalledExactlyOnceWith(runReady.snapshot);
    expect(onFull).not.toHaveBeenCalled();
    expect(server.transport.apply).toHaveBeenCalledTimes(2);

    const allReady = document(
      { sql_a: ["select 11", "1"], sql_b: ["select 22", "2"] },
      "2",
    );
    heldOther.deliver(
      server.commit(allReady, ["sql_b"], otherEdit.opId).receipt,
    );
    await expect(full).resolves.toEqual(allReady.snapshot);
  });

  it("flushes notebook order for a catalog insert without waiting for unrelated typing", async () => {
    const first = document({
      sql_a: ["select 1", "0"],
      sql_b: ["select 2", "0"],
    });
    const server = fixture(first);
    const tab = server.open(first);
    const held = hold<OperationReceipt>();
    server.transport.apply.mockReturnValueOnce(held.response);
    const draft = tab.dispatch(edit("sql_a", "select 11"));
    void draft.receipt.catch(() => undefined);
    const move = tab.dispatch(
      notebookChangeSchema.parse({
        type: "move",
        cellId: "sql_b",
        gap: { afterCellId: null, beforeCellId: "sql_a" },
        expectedOrderRevision: "0",
      }),
    );
    const ready = tab.barrier({ type: "order" });
    const accepted = vi.fn();
    void ready.then(accepted);
    await vi.advanceTimersByTimeAsync(0);
    expect(
      server.transport.apply.mock.calls.map(([command]) => command.opId),
    ).toEqual([move.opId]);
    expect(accepted).not.toHaveBeenCalled();
    const reordered = document(
      {
        sql_b: ["select 2", "0"],
        sql_a: ["select 1", "0"],
      },
      "1",
    );
    held.deliver(
      server.commit(
        {
          ...reordered,
          resources: {
            ...reordered.resources,
            orderRevision: reordered.snapshot.head.revision,
          },
        },
        ["sql_a", "sql_b"],
        move.opId,
      ).receipt,
    );
    await expect(ready).resolves.toEqual(reordered.snapshot);
    expect(tab.getSnapshot().pending.map(({ opId }) => opId)).toEqual([
      draft.opId,
    ]);
  });

  it("debounces unsent typing and replays a frozen command verbatim when no receipt exists", async () => {
    const first = document({ sql_a: ["select 1", "0"] });
    const next = document({ sql_a: ["select 42", "1"] }, "1");
    const server = fixture(first);
    const tab = server.open(first);
    const held = hold<OperationReceipt>();
    server.transport.apply
      .mockReturnValueOnce(held.response)
      .mockImplementationOnce(
        async ({ opId }) => server.commit(next, ["sql_a"], opId).receipt,
      );

    const earlier = tab.dispatch(edit("sql_a", "select 4"));
    await vi.advanceTimersByTimeAsync(400);
    const latest = tab.dispatch(edit("sql_a", "select 42"));
    void earlier.receipt.catch(() => undefined);
    void latest.receipt.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(400);
    expect(server.transport.apply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(server.transport.apply).toHaveBeenCalledTimes(1);
    const firstAttempt = structuredClone(
      server.transport.apply.mock.calls[0]?.[0],
    );
    expect(firstAttempt?.changes).toEqual([edit("sql_a", "select 42")]);

    held.drop(new Error("Offline before commit"));
    await vi.advanceTimersByTimeAsync(350);
    await tab.reconnect();
    await expect(latest.receipt).resolves.toMatchObject({
      status: "applied",
      opId: firstAttempt?.opId,
    });
    expect(server.transport.receipt).toHaveBeenCalledWith(
      { projectId, opId: firstAttempt?.opId },
      expect.any(AbortSignal),
    );
    expect(
      server.transport.apply.mock.calls.map(([command]) => command),
    ).toEqual([firstAttempt, firstAttempt]);
    expect(tab.getSnapshot().accepted).toEqual(next);
  });

  it("freezes sent code and rebases a queued source guard only from its own exact receipt", async () => {
    const base = document({ sql_a: ["select 1", "0"] });
    const server = fixture(base);
    const tab = server.open(base);
    const [heldCode, heldSource] = [
      hold<OperationReceipt>(),
      hold<OperationReceipt>(),
    ];
    server.transport.apply
      .mockReturnValueOnce(heldCode.response)
      .mockReturnValueOnce(heldSource.response);

    const code = tab.dispatch(edit("sql_a", "select 42"));
    await vi.advanceTimersByTimeAsync(500);
    const attempt = structuredClone(server.transport.apply.mock.calls[0]?.[0]);
    const newSource = notebookChangeSchema.parse({
      type: "set-source",
      cellId: "sql_a",
      expectedRevision: "0",
      connectionMode: "warehouse",
      dataConnectionId: "source-new",
    });
    const binding = tab.dispatch(newSource);
    const run = tab.barrier({ type: "run", cellIds: ["sql_a"] });
    const admit = vi.fn();
    void run.then(admit).catch(() => undefined);
    expect(code.opId).not.toBe(binding.opId);
    expect(server.transport.apply).toHaveBeenCalledTimes(1);
    expect(attempt?.changes).toEqual([edit("sql_a", "select 42")]);

    const afterCode = document({ sql_a: ["select 42", "1"] }, "1");
    heldCode.deliver(server.commit(afterCode, ["sql_a"], code.opId).receipt);
    await vi.advanceTimersByTimeAsync(0);
    expect(server.transport.apply.mock.calls[0]?.[0]).toEqual(attempt);
    expect(server.transport.apply.mock.calls[1]?.[0]).toMatchObject({
      opId: binding.opId,
      changes: [{ ...newSource, expectedRevision: "1" }],
    });
    expect(admit).not.toHaveBeenCalled();

    const afterSource = document({ sql_a: ["select 42", "2"] }, "2");
    const contents = afterSource.cells[0]?.contents;
    if (contents?.kind !== "sql") throw new Error("Missing SQL fixture");
    contents.dataConnectionId = "source-new";
    heldSource.deliver(
      server.commit(afterSource, ["sql_a"], binding.opId).receipt,
    );
    await expect(run).resolves.toEqual(afterSource.snapshot);
  });

  it("warns on navigation while a queued or sent edit is unconfirmed", async () => {
    const first = document({ sql_a: ["select 1", "0"] });
    const next = document({ sql_a: ["select 42", "1"] }, "1");
    const server = fixture(first);
    const tab = server.open(first);
    const held = hold<OperationReceipt>();
    server.transport.apply.mockReturnValueOnce(held.response);
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const unbind = warnBeforeNotebookUnload(tab);
    const attemptUnload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      Object.defineProperty(event, "returnValue", {
        value: undefined,
        writable: true,
      });
      return target.dispatchEvent(event);
    };

    expect(attemptUnload()).toBe(true);
    const ticket = tab.dispatch(edit("sql_a", "select 42"));
    expect(attemptUnload()).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(attemptUnload()).toBe(false);
    held.deliver(server.commit(next, ["sql_a"], ticket.opId).receipt);
    await ticket.receipt;
    expect(attemptUnload()).toBe(true);
    unbind();
  });

  it("pauses after logout and ignores the late reply", async () => {
    const first = document({ sql_a: ["select 1", "0"] });
    const server = fixture(first);
    const held = hold<OperationReceipt>();
    server.transport.apply.mockReturnValueOnce(held.response);
    const original = server.open(first);
    const ticket = original.dispatch(edit("sql_a", "select 99"));
    void ticket.receipt.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(500);
    original.pause();
    expect(server.transport.apply.mock.calls[0]?.[1].aborted).toBe(true);

    const committed = server.commit(
      document({ sql_a: ["select 99", "1"] }, "1"),
      ["sql_a"],
      ticket.opId,
    );
    held.deliver(committed.receipt);
    await vi.advanceTimersByTimeAsync(1000);
    expect(original.getSnapshot()).toMatchObject({
      paused: true,
      accepted: null,
      effective: null,
    });
    expect(server.transport.apply).toHaveBeenCalledTimes(1);
    await expect(original.barrier({ type: "full" })).rejects.toBeDefined();
  });

  it("pauses on access revocation and does not send an unsent edit", async () => {
    const first = document({ sql_a: ["select 1", "0"] });
    const server = fixture(first);
    const tab = server.open(first);
    const ticket = tab.dispatch(edit("sql_a", "select 99"));
    void ticket.receipt.catch(() => undefined);
    server.transport.changes.mockRejectedValueOnce(
      Object.assign(new Error("Forbidden"), { status: 403 }),
    );

    await tab.reconnect().catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tab.getSnapshot()).toMatchObject({
      paused: true,
      accepted: null,
      effective: null,
    });
    expect(server.transport.apply).not.toHaveBeenCalled();
  });

  it("keeps writes paused after a failed access recheck", async () => {
    const first = document({ sql_a: ["select 1", "0"] });
    const fixtureServer = fixture(first);
    const tab = fixtureServer.open(first);
    tab.dispatch(edit("sql_a", "select 99"));
    tab.pause();
    fixtureServer.transport.snapshot.mockRejectedValueOnce(
      new Error("Offline"),
    );

    await tab.resume();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fixtureServer.transport.apply).not.toHaveBeenCalled();
    expect(tab.getSnapshot().accepted).toBeNull();
    expect(tab.getSnapshot().effective).toBeNull();
  });

  it("fences queued edits to the old working version when a new lineage opens", async () => {
    const first = document({ sql_a: ["select 1", "0"] });
    const next = document(
      { sql_a: ["select 42", "0"] },
      "0",
      "1",
      "working-v2",
    );
    const server = fixture(first);
    const original = server.open(first);
    const ticket = original.dispatch(edit("sql_a", "select 99"));
    void ticket.receipt.catch(() => undefined);
    server.expire(next);

    await original.reconnect().catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.transport.apply).not.toHaveBeenCalled();
    await expect(original.barrier({ type: "full" })).rejects.toBeDefined();

    const current = server.open(undefined, "working-v2");
    await current.reconnect();
    expect(current.getSnapshot().accepted).toEqual(next);
    expect(source(current.getSnapshot().effective)).toBe("select 42");
    expect(current.getSnapshot().hasUnsavedChanges).toBe(false);
  });

  it("applies bounded random jitter to exponential retry backoff", async () => {
    const first = document({ sql_a: ["select 1", "0"] });
    const next = document({ sql_a: ["select 2", "1"] }, "1");

    const lowRandom = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const lowServer = fixture(first);
      const lowTab = lowServer.open(first);
      lowServer.transport.apply
        .mockRejectedValueOnce(new Error("Temporary 503"))
        .mockImplementationOnce(
          async ({ opId }) => lowServer.commit(next, ["sql_a"], opId).receipt,
        );

      const lowTicket = lowTab.dispatch(edit("sql_a", "select 2"));
      void lowTicket.receipt.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(500);
      expect(lowServer.transport.apply).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(180);
      expect(lowServer.transport.apply).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(20);
      expect(lowServer.transport.apply).toHaveBeenCalledTimes(2);
      await expect(lowTicket.receipt).resolves.toMatchObject({
        status: "applied",
      });
    } finally {
      lowRandom.mockRestore();
    }

    const highRandom = vi.spyOn(Math, "random").mockReturnValue(0.9999);
    try {
      const highServer = fixture(first);
      const highTab = highServer.open(first);
      highServer.transport.apply
        .mockRejectedValueOnce(new Error("Temporary 503"))
        .mockImplementationOnce(
          async ({ opId }) => highServer.commit(next, ["sql_a"], opId).receipt,
        );

      const highTicket = highTab.dispatch(edit("sql_a", "select 2"));
      void highTicket.receipt.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(500);
      expect(highServer.transport.apply).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(250);
      expect(highServer.transport.apply).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(75);
      expect(highServer.transport.apply).toHaveBeenCalledTimes(2);
      await expect(highTicket.receipt).resolves.toMatchObject({
        status: "applied",
      });
    } finally {
      highRandom.mockRestore();
    }
  });
});
