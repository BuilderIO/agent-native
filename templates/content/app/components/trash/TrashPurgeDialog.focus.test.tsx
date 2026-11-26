// @vitest-environment jsdom

import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  trashEmptyRequest,
  type ContentTrashPurgeInput,
  type ContentTrashPurgeRequest,
} from "@/hooks/use-content-trash";

import { TrashPurgeDialog } from "./EmptyTrashDialog";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const pendingPlans: Array<{
  resolve: (value: unknown) => void;
}> = [];
let resolvePlanImmediately = false;
let planFor: ((input: ContentTrashPurgeInput) => Promise<unknown>) | null =
  null;
let executeFor: ((planId: string) => Promise<{ operationId: string }>) | null =
  null;
const executedPlanIds: string[] = [];
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
    mutateAsync: ({ planId }: { planId: string }) => {
      executedPlanIds.push(planId);
      return executeFor
        ? executeFor(planId)
        : Promise.resolve({ operationId: "operation-1" });
    },
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
  executedPlanIds.length = 0;
  toastError.mockReset();
  document.body.replaceChildren();
});

function buttonStartingWith(text: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent.startsWith(text),
  );
}

describe("TrashPurgeDialog focus restoration", () => {
  const cases: Array<[string, ContentTrashPurgeRequest]> = [
    [
      "Delete permanently",
      {
        kind: "delete",
        targets: [
          {
            spaceId: "space-a",
            input: { mode: "selection", documentIds: ["page-1"] },
          },
        ],
      },
    ],
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
      },
    ],
    ["Empty Trash", trashEmptyRequest([])],
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

  it("focuses the stable fallback when acknowledgment unmounts the invoker", async () => {
    resolvePlanImmediately = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <FocusHarness
          label="Delete permanently"
          request={{
            kind: "delete",
            targets: [
              {
                spaceId: "space-a",
                input: { mode: "selection", documentIds: ["page-1"] },
              },
            ],
          }}
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

  async function openEmptyTrash(spaceIds: string[], onAcknowledged = vi.fn()) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <FocusHarness
          label="Empty Trash"
          request={trashEmptyRequest(spaceIds)}
          onAcknowledged={onAcknowledged}
        />,
      );
    });
    await act(async () => host.querySelector("button")?.click());
    return { root, onAcknowledged };
  }

  it("says how many pages each workspace loses, then empties them all", async () => {
    planFor = planByWorkspace;
    executeFor = (planId) => Promise.resolve({ operationId: `op-${planId}` });
    const { root, onAcknowledged } = await openEmptyTrash([
      "space-a",
      "space-b",
      "space-c",
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

    expect(executedPlanIds).toEqual(["plan-space-a", "plan-space-b"]);
    expect(onAcknowledged).toHaveBeenCalledWith([
      "op-plan-space-a",
      "op-plan-space-b",
    ]);
    await act(async () => root.unmount());
  });

  it("keeps the started purges when a later workspace fails to start", async () => {
    planFor = planByWorkspace;
    executeFor = (planId) =>
      planId === "plan-space-b"
        ? Promise.reject(new Error("offline"))
        : Promise.resolve({ operationId: `op-${planId}` });
    const { root, onAcknowledged } = await openEmptyTrash([
      "space-a",
      "space-b",
    ]);

    await act(async () => buttonStartingWith("trash.deleteCount")?.click());

    expect(onAcknowledged).toHaveBeenCalledWith(["op-plan-space-a"]);
    expect(toastError).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("reports an empty Trash instead of a failure when no workspace has pages", async () => {
    planFor = planByWorkspace;
    const { root } = await openEmptyTrash(["space-c"]);

    expect(document.body.textContent).toContain("trash.empty");
    expect(buttonStartingWith("trash.deleteCount")?.disabled).toBe(true);
    await act(async () => root.unmount());
  });
});

function FocusHarness({
  label,
  request,
  hideTriggerOnAcknowledge = false,
  onAcknowledged,
}: {
  label: string;
  request: ContentTrashPurgeRequest;
  hideTriggerOnAcknowledge?: boolean;
  onAcknowledged?: (operationIds: string[]) => void;
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
        onAcknowledged={(operationIds) => {
          onAcknowledged?.(operationIds);
          setActive(null);
          if (hideTriggerOnAcknowledge) setShowTrigger(false);
        }}
        returnFocus={() => triggerRef.current ?? fallbackRef.current}
      />
    </>
  );
}
