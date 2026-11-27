// @vitest-environment jsdom

import type { ContentTrashPurgeSpace } from "@shared/content-trash";
import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  trashEmptyRequest,
  upsertTrashPurgeStarts,
  type ContentTrashPurgeInput,
  type ContentTrashPurgeRequest,
  type ContentTrashPurgeStart,
} from "@/hooks/use-content-trash";

import { TrashOperationSurface, TrashPurgeDialog } from "./EmptyTrashDialog";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type ExecuteInput = {
  planId: string;
  idempotencyKey: string;
} & ({ scopeToken: string } | { recover: true });

const pendingPlans: Array<{
  resolve: (value: unknown) => void;
}> = [];
let resolvePlanImmediately = false;
let planFor: ((input: ContentTrashPurgeInput) => Promise<unknown>) | null =
  null;
let executeFor:
  | ((input: ExecuteInput) => Promise<{ operationId: string }>)
  | null = null;
const executed: ExecuteInput[] = [];
const events: string[] = [];
const toastError = vi.fn();

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key} ${JSON.stringify(options)}` : key,
}));
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));
vi.mock("@/hooks/use-content-trash", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-content-trash")>()),
  usePlanContentTrashPurge: () => ({
    mutateAsync: (input: ContentTrashPurgeInput) =>
      planFor
        ? planFor(input)
        : resolvePlanImmediately
          ? Promise.resolve({
              planId: "plan-1",
              scopeToken: "scope-1",
              eligibleCount: 1,
              blockedCount: 0,
            })
          : new Promise((resolve) => {
              pendingPlans.push({ resolve });
            }),
  }),
  useExecuteContentTrashPurge: () => ({
    isPending: false,
    mutateAsync: (input: ExecuteInput) => {
      executed.push(input);
      events.push(`execute:${input.planId}`);
      return executeFor
        ? executeFor(input)
        : Promise.resolve({ operationId: "operation-1" });
    },
  }),
  useContentTrashOperation: (operationId: string | null) => ({
    data: operationId
      ? {
          pages: [
            {
              operationId,
              planId: "plan",
              idempotencyKey: "key",
              status: "running",
              deletedCount: 1,
              blockedCount: 0,
              conflictedCount: 0,
              outcomes: [],
            },
          ],
        }
      : undefined,
    isError: false,
    hasNextPage: false,
  }),
}));
vi.mock("./TrashPurgeScope", () => ({
  TrashPurgeScope: () => null,
  useTrashPurgeScopeReady: () => ({ ready: true }),
}));

afterEach(() => {
  pendingPlans.length = 0;
  resolvePlanImmediately = false;
  planFor = null;
  executeFor = null;
  executed.length = 0;
  events.length = 0;
  toastError.mockReset();
  document.body.replaceChildren();
});

function space(spaceId: string, canPurge = true): ContentTrashPurgeSpace {
  return { spaceId, name: spaceId, canPurge };
}

function deferred<T>() {
  const handle: { resolve: (value: T) => void } = { resolve: () => {} };
  const promise = new Promise<T>((resolve) => {
    handle.resolve = resolve;
  });
  return { promise, resolve: (value: T) => handle.resolve(value) };
}

function buttonStartingWith(text: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent.startsWith(text),
  );
}

function pressEscape() {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
}

const dialogOpen = () =>
  document.querySelector('[role="alertdialog"]') !== null;

describe("TrashPurgeDialog focus restoration", () => {
  const selectionRequest: ContentTrashPurgeRequest = {
    kind: "delete",
    targets: [
      {
        spaceId: "space-a",
        input: { mode: "selection", documentIds: ["page-1"] },
      },
    ],
    unavailableSpaceIds: [],
  };
  const cases: Array<[string, ContentTrashPurgeRequest]> = [
    ["Delete permanently", selectionRequest],
    [
      "Delete all matching",
      {
        kind: "delete",
        targets: [
          {
            spaceId: "space-a",
            input: {
              mode: "matching",
              filters: { query: "draft", spaceId: "space-a" },
            },
          },
        ],
        unavailableSpaceIds: [],
      },
    ],
    ["Empty Trash", trashEmptyRequest([space("space-a")])],
  ];
  for (const [label, request] of cases) {
    it(`returns focus to ${label} after cancel during planning`, async () => {
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      await act(async () => {
        root.render(<FocusHarness label={label} request={request} />);
      });
      const trigger = host.querySelector<HTMLButtonElement>("button");
      expect(trigger).not.toBeNull();
      trigger?.focus();
      await act(async () => trigger?.click());
      const cancel = [
        ...document.querySelectorAll<HTMLButtonElement>("button"),
      ].find((button) => button.textContent === "trash.cancel");
      expect(cancel).not.toBeUndefined();
      await act(async () => cancel?.click());
      expect(document.activeElement).toBe(trigger);

      await act(async () => pendingPlans.shift()?.resolve({ planId: "stale" }));
      expect(document.activeElement).toBe(trigger);
      await act(async () => root.unmount());
    });
  }

  it("returns focus to the invoker when Escape closes a reviewed plan", async () => {
    resolvePlanImmediately = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <FocusHarness label="Row actions" request={selectionRequest} />,
      );
    });
    const trigger = host.querySelector<HTMLButtonElement>("button");
    trigger?.focus();
    await act(async () => trigger?.click());
    expect(buttonStartingWith("trash.deleteCount")?.disabled).toBe(false);

    await act(async () => pressEscape());

    expect(dialogOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger);
    await act(async () => root.unmount());
  });

  it("focuses the stable fallback when acknowledgment unmounts the invoker", async () => {
    resolvePlanImmediately = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <FocusHarness
          label="Delete permanently"
          request={selectionRequest}
          hideTriggerOnAcknowledge
        />,
      );
    });
    const trigger = host.querySelector<HTMLButtonElement>("button");
    await act(async () => trigger?.click());
    const confirm = buttonStartingWith("trash.deleteCount");
    expect(confirm?.disabled).toBe(false);
    await act(async () => confirm?.click());
    expect(document.activeElement).toBe(
      host.querySelector('[data-focus-fallback=""]'),
    );
    await act(async () => root.unmount());
  });
});

describe("Empty Trash across workspaces", () => {
  function planByWorkspace(input: ContentTrashPurgeInput) {
    const spaceId = input.mode === "scope" ? input.spaceId : undefined;
    if (spaceId === "space-c")
      return Promise.reject(
        Object.assign(new Error("Nothing to purge"), {
          errorCode: "empty_scope",
        }),
      );
    return Promise.resolve({
      planId: `plan-${spaceId}`,
      scopeToken: `scope-${spaceId}`,
      eligibleCount: spaceId === "space-a" ? 2 : 3,
      blockedCount: spaceId === "space-a" ? 1 : 0,
    });
  }

  function acceptingServer(lose: Set<string>) {
    const operations = new Map<string, string>();
    executeFor = (input) => {
      const operationId =
        operations.get(input.idempotencyKey) ?? `op-${input.planId}`;
      operations.set(input.idempotencyKey, operationId);
      if (lose.delete(input.planId))
        return Promise.reject(new TypeError("Failed to fetch"));
      return Promise.resolve({ operationId });
    };
    return operations;
  }

  async function openEmptyTrash(
    spaces: ContentTrashPurgeSpace[],
    options: {
      onAcknowledged?: () => void;
      onStartsChange?: (starts: ContentTrashPurgeStart[]) => Promise<void>;
    } = {},
  ) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onAcknowledged = options.onAcknowledged ?? vi.fn();
    let saved: ContentTrashPurgeStart[] = [];
    await act(async () => {
      root.render(
        <FocusHarness
          label="Empty Trash"
          request={trashEmptyRequest(spaces)}
          onAcknowledged={onAcknowledged}
          onStartsChange={
            options.onStartsChange ??
            (async (starts) => {
              events.push(
                `save:${starts.map((start) => start.status).join(",")}`,
              );
              saved = upsertTrashPurgeStarts(saved, starts);
            })
          }
        />,
      );
    });
    await act(async () => host.querySelector("button")?.click());
    return { root, onAcknowledged, saved: () => saved };
  }

  it("says how many pages each workspace loses, then empties them all", async () => {
    planFor = planByWorkspace;
    executeFor = ({ planId }) =>
      Promise.resolve({ operationId: `op-${planId}` });
    const { root, onAcknowledged, saved } = await openEmptyTrash([
      space("space-a"),
      space("space-b"),
      space("space-c"),
    ]);
    const text = document.body.textContent;

    expect(text).toContain(
      'trash.workspaceScopeCounts {"workspace":"Workspace space-a","eligible":2,"blocked":1}',
    );
    expect(text).toContain(
      'trash.workspaceScopeCounts {"workspace":"Workspace space-b","eligible":3,"blocked":0}',
    );
    expect(text).toContain(
      'trash.workspaceScopeCounts {"workspace":"Workspace space-c","eligible":0,"blocked":0}',
    );
    expect(text).toContain('trash.deleteQuestion {"count":5}');

    await act(async () => buttonStartingWith("trash.deleteCount")?.click());

    expect(events.slice(0, 2)).toEqual([
      "save:starting,starting",
      "execute:plan-space-a",
    ]);
    expect(executed.map((input) => input.planId)).toEqual([
      "plan-space-a",
      "plan-space-b",
    ]);
    expect(
      saved().map(({ planId, status, operationId }) => [
        planId,
        status,
        operationId,
      ]),
    ).toEqual([
      ["plan-space-a", "started", "op-plan-space-a"],
      ["plan-space-b", "started", "op-plan-space-b"],
    ]);
    expect(onAcknowledged).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("keeps a workspace whose start response was lost unknown, and retries it with its original key", async () => {
    planFor = planByWorkspace;
    const operations = acceptingServer(new Set(["plan-space-b"]));
    const { root, onAcknowledged, saved } = await openEmptyTrash([
      space("space-a"),
      space("space-b"),
      space("space-d"),
    ]);

    await act(async () => buttonStartingWith("trash.deleteCount")?.click());

    expect(executed.map((input) => input.planId)).toEqual([
      "plan-space-a",
      "plan-space-b",
      "plan-space-d",
    ]);
    expect(saved().map(({ spaceId, status }) => [spaceId, status])).toEqual([
      ["space-a", "started"],
      ["space-b", "unknown"],
      ["space-d", "started"],
    ]);
    const text = document.body.textContent;
    expect(text).toContain(
      'trash.startStarted {"workspace":"Workspace space-a"}',
    );
    expect(text).toContain(
      'trash.startUnknown {"workspace":"Workspace space-b"}',
    );
    expect(onAcknowledged).not.toHaveBeenCalled();
    expect(dialogOpen()).toBe(true);
    const firstKey = executed[1]?.idempotencyKey;

    await act(async () => buttonStartingWith("trash.retry")?.click());

    expect(executed.slice(3)).toEqual([
      {
        planId: "plan-space-b",
        scopeToken: "scope-space-b",
        idempotencyKey: firstKey,
      },
    ]);
    expect(operations.size).toBe(3);
    expect(saved().map(({ status }) => status)).toEqual([
      "started",
      "started",
      "started",
    ]);
    expect(onAcknowledged).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("can't be dismissed while purges are starting", async () => {
    planFor = planByWorkspace;
    const response = deferred<{ operationId: string }>();
    executeFor = () => response.promise;
    const { root, onAcknowledged } = await openEmptyTrash([space("space-a")]);

    await act(async () => buttonStartingWith("trash.deleteCount")?.click());

    expect(buttonStartingWith("trash.cancel")?.disabled).toBe(true);
    await act(async () => pressEscape());
    expect(dialogOpen()).toBe(true);

    await act(async () => response.resolve({ operationId: "op-a" }));

    expect(onAcknowledged).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("starts nothing when the start records can't be saved first", async () => {
    planFor = planByWorkspace;
    const onStartsChange = vi
      .fn<(starts: ContentTrashPurgeStart[]) => Promise<void>>()
      .mockRejectedValue(new Error("offline"));
    const { root, onAcknowledged } = await openEmptyTrash(
      [space("space-a"), space("space-b")],
      { onStartsChange },
    );

    await act(async () => buttonStartingWith("trash.deleteCount")?.click());

    expect(executed).toEqual([]);
    expect(document.body.textContent).toContain("trash.startRecordFailed");
    expect(onStartsChange.mock.lastCall?.[0]).toEqual([
      expect.objectContaining({ spaceId: "space-a", status: "failed" }),
      expect.objectContaining({ spaceId: "space-b", status: "failed" }),
    ]);
    expect(onAcknowledged).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("names a viewer workspace as not purgeable instead of failing the rest", async () => {
    planFor = planByWorkspace;
    executeFor = ({ planId }) =>
      Promise.resolve({ operationId: `op-${planId}` });
    const { root, onAcknowledged } = await openEmptyTrash([
      space("space-a"),
      space("viewer-space", false),
    ]);

    expect(document.body.textContent).toContain(
      'trash.cannotPurgeWorkspace {"workspace":"Workspace viewer-space"}',
    );
    await act(async () => buttonStartingWith("trash.deleteCount")?.click());

    expect(executed.map((input) => input.planId)).toEqual(["plan-space-a"]);
    expect(onAcknowledged).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("offers nothing to delete when every workspace is view-only", async () => {
    const { root } = await openEmptyTrash([space("viewer-space", false)]);

    expect(document.body.textContent).toContain(
      'trash.cannotPurgeWorkspace {"workspace":"Workspace viewer-space"}',
    );
    expect(buttonStartingWith("trash.deleteCount")?.disabled).toBe(true);
    await act(async () => root.unmount());
  });

  it("reports an empty Trash instead of a failure when no workspace has pages", async () => {
    planFor = planByWorkspace;
    const { root } = await openEmptyTrash([space("space-c")]);

    expect(document.body.textContent).toContain("trash.empty");
    expect(buttonStartingWith("trash.deleteCount")?.disabled).toBe(true);
    await act(async () => root.unmount());
  });
});

describe("Saved purge starts after a reload", () => {
  const unknownStart: ContentTrashPurgeStart = {
    spaceId: "space-b",
    planId: "plan-b",
    idempotencyKey: "key-b",
    status: "unknown",
    operationId: null,
    error: "Failed to fetch",
    input: { mode: "scope", spaceId: "space-b" },
  };
  const refusal = (errorCode: string) =>
    Object.assign(new Error(errorCode), { status: 409, errorCode });

  async function renderSurface(starts: ContentTrashPurgeStart[]) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const saves: ContentTrashPurgeStart[][] = [];
    const reviewed: ContentTrashPurgeStart[] = [];
    await act(async () => {
      root.render(
        <SurfaceHarness
          initial={starts}
          onSave={(update) => saves.push(update)}
          onReviewAgain={(start) => reviewed.push(start)}
        />,
      );
    });
    return { host, root, saves, reviewed };
  }

  it("retries an unknown start with its saved plan and key, then follows the operation", async () => {
    executeFor = () => Promise.resolve({ operationId: "op-b" });
    const { host, root, saves } = await renderSurface([unknownStart]);

    expect(host.textContent).toContain(
      'trash.startUnknown {"workspace":"Workspace space-b"}',
    );
    await act(async () => buttonStartingWith("trash.retry")?.click());

    expect(executed).toEqual([
      { planId: "plan-b", idempotencyKey: "key-b", recover: true },
    ]);
    expect(saves).toEqual([
      [
        {
          ...unknownStart,
          status: "started",
          operationId: "op-b",
          error: null,
        },
      ],
    ]);
    expect(host.textContent).toContain('trash.running {"count":1}');
    await act(async () => root.unmount());
  });

  it("keeps retrying a start the server hasn't settled, until the original commits and is followed", async () => {
    const answers = [
      () => Promise.reject(refusal("start_pending")),
      () => Promise.reject(refusal("invalid_scope")),
      () => Promise.resolve({ operationId: "op-b" }),
    ];
    executeFor = () => {
      const answer = answers.shift();
      return answer ? answer() : Promise.reject(new Error("unexpected retry"));
    };
    const { host, root, saves } = await renderSurface([unknownStart]);

    await act(async () => buttonStartingWith("trash.retry")?.click());
    await act(async () => buttonStartingWith("trash.retry")?.click());

    expect(saves.map((update) => update.map((start) => start.status))).toEqual([
      ["unknown"],
      ["unknown"],
    ]);
    expect(host.textContent).toContain(
      'trash.startUnknown {"workspace":"Workspace space-b"}',
    );

    await act(async () => buttonStartingWith("trash.retry")?.click());

    expect(executed).toEqual(
      Array.from({ length: 3 }, () => ({
        planId: "plan-b",
        idempotencyKey: "key-b",
        recover: true,
      })),
    );
    expect(saves.slice(2)).toEqual([
      [
        {
          ...unknownStart,
          status: "started",
          operationId: "op-b",
          error: null,
        },
      ],
    ]);
    expect(host.textContent).toContain('trash.running {"count":1}');
    await act(async () => root.unmount());
  });

  it("says the start expired once the server rules it out, and offers a new review", async () => {
    executeFor = () => Promise.reject(refusal("start_expired"));
    const { host, root, saves, reviewed } = await renderSurface([unknownStart]);

    await act(async () => buttonStartingWith("trash.retry")?.click());

    expect(saves).toEqual([
      [{ ...unknownStart, status: "failed", error: "trash.startExpired" }],
    ]);
    expect(host.textContent).toContain(
      'trash.startDidNotStart {"workspace":"Workspace space-b","error":"trash.startExpired"}',
    );
    expect(buttonStartingWith("trash.retry")).toBeUndefined();

    await act(async () => buttonStartingWith("trash.reviewAgain")?.click());

    expect(reviewed).toEqual([
      { ...unknownStart, status: "failed", error: "trash.startExpired" },
    ]);
    await act(async () => root.unmount());
  });
});

function SurfaceHarness({
  initial,
  onSave,
  onReviewAgain,
}: {
  initial: ContentTrashPurgeStart[];
  onSave: (starts: ContentTrashPurgeStart[]) => void;
  onReviewAgain: (start: ContentTrashPurgeStart) => void;
}) {
  const [starts, setStarts] = useState(initial);
  return (
    <TrashOperationSurface
      starts={starts}
      stateError={false}
      spaceName={(spaceId) => `Workspace ${spaceId}`}
      onRetryState={() => {}}
      onStartsChange={async (updates) => {
        onSave(updates);
        setStarts((current) => upsertTrashPurgeStarts(current, updates));
      }}
      onDismiss={() => setStarts([])}
      onReviewAgain={onReviewAgain}
    />
  );
}

function FocusHarness({
  label,
  request,
  hideTriggerOnAcknowledge = false,
  onAcknowledged,
  onStartsChange = async () => {},
}: {
  label: string;
  request: ContentTrashPurgeRequest;
  hideTriggerOnAcknowledge?: boolean;
  onAcknowledged?: () => void;
  onStartsChange?: (starts: ContentTrashPurgeStart[]) => Promise<void>;
}) {
  const [active, setActive] = useState<ContentTrashPurgeRequest | null>(null);
  const [showTrigger, setShowTrigger] = useState(true);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fallbackRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      {showTrigger ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setActive(request)}
        >
          {label}
        </button>
      ) : null}
      <button ref={fallbackRef} type="button" data-focus-fallback="">
        Fallback row
      </button>
      <TrashPurgeDialog
        request={active}
        spaceName={(spaceId) => `Workspace ${spaceId}`}
        onClose={() => setActive(null)}
        onStartsChange={onStartsChange}
        onAcknowledged={() => {
          onAcknowledged?.();
          setActive(null);
          if (hideTriggerOnAcknowledge) setShowTrigger(false);
        }}
        returnFocus={() => triggerRef.current ?? fallbackRef.current}
      />
    </>
  );
}
