// @vitest-environment jsdom

import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContentTrashPurgeInput } from "@/hooks/use-content-trash";

import { TrashPurgeDialog } from "./EmptyTrashDialog";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const pendingPlans: Array<{
  resolve: (value: unknown) => void;
}> = [];
let resolvePlanImmediately = false;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@/hooks/use-content-trash", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-content-trash")>()),
  usePlanContentTrashPurge: () => ({
    isPending: !resolvePlanImmediately,
    mutateAsync: () =>
      resolvePlanImmediately
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
    mutateAsync: () => Promise.resolve({ operationId: "operation-1" }),
  }),
}));
vi.mock("./TrashPurgeScope", () => ({
  TrashPurgeScope: () => null,
  useTrashPurgeScopeReady: () => ({ ready: true }),
}));

afterEach(() => {
  pendingPlans.length = 0;
  resolvePlanImmediately = false;
  document.body.replaceChildren();
});

describe("TrashPurgeDialog focus restoration", () => {
  const cases: Array<[string, ContentTrashPurgeInput]> = [
    ["Delete permanently", { mode: "selection", documentIds: ["page-1"] }],
    ["Delete all matching", { mode: "matching", filters: { query: "draft" } }],
    ["Empty Trash", { mode: "scope" }],
  ];
  for (const [label, input] of cases) {
    it(`returns focus to ${label} after cancel during planning`, async () => {
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      await act(async () => {
        root.render(<FocusHarness label={label} input={input} />);
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
          input={{ mode: "selection", documentIds: ["page-1"] }}
          hideTriggerOnAcknowledge
        />,
      );
    });
    const trigger = host.querySelector<HTMLButtonElement>("button");
    await act(async () => trigger?.click());
    const confirm = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "trash.deleteCount");
    expect(confirm?.disabled).toBe(false);
    await act(async () => confirm?.click());
    expect(document.activeElement).toBe(
      host.querySelector('[data-focus-fallback=""]'),
    );
    await act(async () => root.unmount());
  });
});

function FocusHarness({
  label,
  input,
  hideTriggerOnAcknowledge = false,
}: {
  label: string;
  input: ContentTrashPurgeInput;
  hideTriggerOnAcknowledge?: boolean;
}) {
  const [intent, setIntent] = useState<ContentTrashPurgeInput | null>(null);
  const [showTrigger, setShowTrigger] = useState(true);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fallbackRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      {showTrigger ? (
        <button ref={triggerRef} type="button" onClick={() => setIntent(input)}>
          {label}
        </button>
      ) : null}
      <button ref={fallbackRef} type="button" data-focus-fallback="">
        Fallback row
      </button>
      <TrashPurgeDialog
        intent={intent}
        onClose={() => setIntent(null)}
        onAcknowledged={() => {
          setIntent(null);
          if (hideTriggerOnAcknowledge) setShowTrigger(false);
        }}
        returnFocus={() => triggerRef.current ?? fallbackRef.current}
      />
    </>
  );
}
