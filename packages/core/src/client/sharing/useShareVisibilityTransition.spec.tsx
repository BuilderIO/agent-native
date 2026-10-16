// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ShareVisibilityNotSavedError,
  useShareVisibilityTransition,
  type ShareVisibilityTransition,
  type ShareVisibilityTransitionOptions,
} from "./useShareVisibilityTransition.js";

vi.mock("../org/hooks.js", () => ({ useOrg: () => ({ data: undefined }) }));

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("useShareVisibilityTransition resource locks", () => {
  let container: HTMLDivElement;
  let root: Root;
  let transition: ShareVisibilityTransition;
  let options: ShareVisibilityTransitionOptions;

  function Harness() {
    transition = useShareVisibilityTransition(options);
    return null;
  }

  function render(next: Partial<ShareVisibilityTransitionOptions> = {}) {
    options = { ...options, ...next };
    act(() => root.render(<Harness />));
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    options = {
      resourceType: "document",
      resourceId: "a",
      current: "private",
      orgId: null,
      canManage: true,
      active: true,
      apply: vi.fn(),
      onDirectError: vi.fn(),
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it.each(["org", "private"] as const)(
    "locks a revisited resource with %s current visibility while another resource saves",
    async (current) => {
      const a = deferred();
      const b = deferred();
      const applyA = vi.fn(() => a.promise);
      const applyB = vi.fn(() => b.promise);
      render({ apply: applyA });
      let held!: Promise<void>;
      act(() => {
        held = transition.request("org");
      });
      let confirmed!: Promise<void>;
      act(() => {
        confirmed = transition.confirm();
      });

      render({ resourceId: "b", apply: applyB });
      let savedB!: Promise<void>;
      act(() => {
        savedB = transition.request("public");
      });
      expect(applyB).toHaveBeenCalledWith("public");

      render({ resourceId: "a", current, apply: applyA });
      await expect(transition.request("private")).rejects.toMatchObject({
        name: "ShareVisibilityNotSavedError",
        reason: "ignored",
      });
      const repeated = transition.request("org");
      expect(repeated).toBe(a.promise);
      expect(applyA).toHaveBeenCalledTimes(1);
      await act(async () => {
        a.resolve();
        await confirmed;
        await held;
        await repeated;
      });

      await act(async () => {
        b.resolve();
        await savedB;
      });
      expect(transition.pending).toBeNull();
      expect(transition.error).toBeNull();
      render({ current: "org" });
      await act(async () => {
        await transition.request("private");
      });
      expect(applyA).toHaveBeenCalledTimes(2);
    },
  );

  it("locks direct writes per resource through close and revisit, joins the target and releases on failure", async () => {
    const a = deferred();
    const b = deferred();
    const retry = deferred();
    const applyA = vi
      .fn()
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(retry.promise);
    const applyB = vi.fn(() => b.promise);
    render({ current: "org", apply: applyA });
    let savedA!: Promise<void>;
    act(() => {
      savedA = transition.request("private");
    });
    render({ current: "private", active: false });
    render({ active: true });
    await expect(transition.request("public")).rejects.toMatchObject({
      reason: "ignored",
    });
    expect(transition.request("private")).toBe(savedA);
    expect(applyA).toHaveBeenCalledTimes(1);

    render({ resourceId: "b", current: "org", apply: applyB });
    let savedB!: Promise<void>;
    act(() => {
      savedB = transition.request("public");
    });
    expect(applyB).toHaveBeenCalledWith("public");
    render({ resourceId: "a", current: "private", apply: applyA });
    await expect(transition.request("org")).rejects.toMatchObject({
      reason: "ignored",
    });
    expect(transition.pending).toBeNull();
    expect(transition.request("private")).toBe(savedA);
    const failure = new Error("direct save failed");
    await act(async () => {
      a.reject(failure);
      await expect(savedA).rejects.toBe(failure);
    });
    render({ current: "org" });
    let savedRetry!: Promise<void>;
    act(() => {
      savedRetry = transition.request("public");
    });
    expect(applyA).toHaveBeenCalledTimes(2);
    await act(async () => {
      retry.resolve();
      b.resolve();
      await savedRetry;
      await savedB;
    });
  });

  it("keeps an active confirmation failure retryable and resolves its caller after persistence", async () => {
    const first = deferred();
    const retry = deferred();
    const apply = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise);
    render({ apply });
    let held!: Promise<void>;
    let settled = false;
    act(() => {
      held = transition.request("org");
    });
    void held.then(() => {
      settled = true;
    });
    let confirmed!: Promise<void>;
    act(() => {
      confirmed = transition.confirm();
    });
    await act(async () => {
      first.reject(new Error("active save failed"));
      await confirmed;
    });
    expect(transition.error).toBe("active save failed");
    expect(transition.pending).toEqual({ from: "private", to: "org" });
    expect(settled).toBe(false);
    act(() => {
      confirmed = transition.confirm();
    });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(settled).toBe(false);
    await act(async () => {
      retry.resolve();
      await confirmed;
      await held;
    });
    expect(settled).toBe(true);
    expect(transition.pending).toBeNull();
    expect(transition.error).toBeNull();
  });

  it("invalidates a failed confirmed caller with a typed drop after rights are lost", async () => {
    const write = deferred();
    render({ apply: () => write.promise });
    let held!: Promise<void>;
    let confirmed!: Promise<void>;
    act(() => {
      held = transition.request("org");
    });
    act(() => {
      confirmed = transition.confirm();
    });
    render({ canManage: false });
    const rejected = expect(held).rejects.toBeInstanceOf(
      ShareVisibilityNotSavedError,
    );
    await act(async () => {
      write.reject(new Error("invalidated save failed"));
      await confirmed;
      await rejected;
    });
    expect(transition.error).toBeNull();
    expect(options.onDirectError).not.toHaveBeenCalled();
  });
});
