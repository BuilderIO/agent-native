// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { A11yFinding } from "../../../shared/design-review.js";
import { ReviewPanel } from "./ReviewPanel";

const mutateAsync = vi.fn();
vi.mock("@agent-native/core/client", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
  useActionMutation: () => ({
    mutateAsync: (...args: unknown[]) => mutateAsync(...args),
  }),
}));

function finding(overrides: Partial<A11yFinding> = {}): A11yFinding {
  return {
    id: "contrast:node-42",
    severity: "error",
    category: "contrast",
    message: "Contrast ratio 2.1:1 — minimum is 4.5:1",
    nodeId: "node-42",
    fixAvailable: true,
    ...overrides,
  };
}

let cleanup: (() => Promise<void>) | undefined;
let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mutateAsync.mockReset();
});

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  root = undefined;
  container = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function renderPanel(findings: A11yFinding[]) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  cleanup = async () => {
    await act(async () => root?.unmount());
    container?.remove();
  };
  const rerender = async (nextFindings: A11yFinding[]) => {
    await act(async () => {
      root!.render(
        <ReviewPanel
          findings={nextFindings}
          fixSource={{ designId: "design-1", fileId: "file-1" }}
        />,
      );
    });
  };
  await rerender(findings);
  return { rerender };
}

describe("ReviewPanel FindingRow fix status", () => {
  it("does not keep showing 'Fixed' if a fresh audit re-reports the same finding", async () => {
    mutateAsync.mockResolvedValue({ applied: true });
    const original = finding();
    const { rerender } = await renderPanel([original]);

    const fixButton = Array.from(container!.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Fix"),
    );
    if (!fixButton) throw new Error("Fix button did not render");
    await act(async () => {
      fixButton.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container!.textContent).toContain("Fixed");

    // A fresh audit pass returns a *new* finding object with the same stable
    // id — meaning the fix didn't actually resolve it. The row must not keep
    // showing a stale "Fixed" checkmark for a currently-live issue.
    const reAudited = finding({
      message: "Contrast ratio 2.3:1 — minimum is 4.5:1",
    });
    await rerender([reAudited]);

    expect(container!.textContent).not.toContain("Fixed");
    const retriedFixButton = Array.from(
      container!.querySelectorAll("button"),
    ).find((btn) => btn.textContent?.includes("Fix"));
    expect(retriedFixButton).toBeTruthy();
  });

  it("keeps showing 'Fixed' across re-renders that don't change the finding", async () => {
    mutateAsync.mockResolvedValue({ applied: true });
    const original = finding();
    const { rerender } = await renderPanel([original]);

    const fixButton = Array.from(container!.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Fix"),
    );
    await act(async () => {
      fixButton?.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container!.textContent).toContain("Fixed");

    // Re-rendering with the exact same finding reference (e.g. a parent
    // re-render unrelated to the audit) must not reset the optimistic state.
    await rerender([original]);
    expect(container!.textContent).toContain("Fixed");
  });
});

describe("ReviewPanel FindingRow keyboard activation", () => {
  it("prevents the default Space scroll when activating a finding row via keyboard", async () => {
    const onFindingClick = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    cleanup = async () => {
      await act(async () => root?.unmount());
      container?.remove();
    };
    await act(async () => {
      root!.render(
        <ReviewPanel findings={[finding()]} onFindingClick={onFindingClick} />,
      );
    });

    const row = container.querySelector('[role="button"]');
    if (!row) throw new Error("Finding row did not render");
    const event = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      row.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(onFindingClick).toHaveBeenCalledWith(finding());
  });
});
