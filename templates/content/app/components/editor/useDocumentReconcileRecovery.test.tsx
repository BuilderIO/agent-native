// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useDocumentReconcileRecovery,
  type ReconcileSaveBase,
} from "./useDocumentReconcileRecovery";

let root: Root;
let container: HTMLDivElement;
let recovery: ReturnType<typeof useDocumentReconcileRecovery>;
let draft: string;
const base = {
  title: "Saved title",
  content: "saved remotely",
  updatedAt: "2026-09-10T12:00:00.000Z",
};

beforeEach(() => {
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  draft = "my edits";
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(
  save: (
    draft: { localDraft: string; localTitle: string },
    snapshot?: ReconcileSaveBase,
  ) => Promise<boolean>,
  getSaveIdentity?: () => string,
  retain?: (draft: { localDraft: string; localTitle: string }) => Promise<void>,
) {
  function Harness() {
    recovery = useDocumentReconcileRecovery({
      save,
      getDraft: () => draft,
      getSaveIdentity,
      retain,
    });
    return null;
  }
  act(() => root.render(<Harness />));
  act(() => recovery.report("conflict", draft));
}

function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("document reconcile recovery", () => {
  it("saves text typed during recovery before clearing the banner", async () => {
    const first = deferred();
    const second = deferred();
    const save = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    mount(save);
    let result!: Promise<boolean>;
    act(() => {
      result = recovery.resolve(base);
    });
    expect(recovery.state?.saving).toBe(true);
    act(() => {
      draft = "my edits plus more typing";
      recovery.updateDraft(draft);
    });
    await act(async () => first.resolve(true));
    expect(recovery.state?.localDraft).toBe(draft);
    expect(recovery.state?.saving).toBe(true);
    expect(save.mock.calls).toEqual([
      [{ localDraft: "my edits", localTitle: "" }, base],
      [{ localDraft: draft, localTitle: "" }, undefined],
    ]);
    await act(async () => second.resolve(true));
    expect(await result).toBe(true);
    expect(recovery.state).toBeNull();
  });

  it("saves a title edited during recovery even when the body is unchanged", async () => {
    const first = deferred();
    let title = "Original title";
    const savedTitles: string[] = [];
    mount(
      async () => {
        savedTitles.push(title);
        return savedTitles.length === 1 ? first.promise : true;
      },
      () => JSON.stringify([title, draft]),
    );
    let result!: Promise<boolean>;
    act(() => {
      result = recovery.resolve(base);
    });
    title = "Edited while saving";
    await act(async () => first.resolve(true));
    expect(await result).toBe(true);
    expect(savedTitles).toEqual(["Original title", "Edited while saving"]);
    expect(recovery.state).toBeNull();
  });

  it("retains the latest draft and distinguishes a rejected save from an overlap", async () => {
    const first = deferred();
    const save = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(new Error("offline"));
    mount(save);
    let result!: Promise<boolean>;
    act(() => {
      result = recovery.resolve(base);
    });
    act(() => {
      draft = "newer typing";
      recovery.updateDraft(draft);
    });
    await act(async () => first.resolve(true));
    expect(await result).toBe(false);
    expect(recovery.state).toEqual({
      reason: "save-failed",
      localDraft: draft,
      localTitle: "",
      saving: false,
    });
  });

  it("does not let an older successful save clear a newer remote conflict", async () => {
    const first = deferred();
    mount(() => first.promise);
    let result!: Promise<boolean>;
    act(() => {
      result = recovery.resolve(base);
    });
    act(() => {
      draft = "latest draft";
      recovery.report("conflict", draft);
    });
    await act(async () => first.resolve(true));
    expect(await result).toBe(false);
    expect(recovery.state).toEqual({
      reason: "conflict",
      localDraft: draft,
      localTitle: "",
      saving: false,
    });
  });

  it("does not let a secondary choice dismiss typing added while it resolves", async () => {
    const choice = deferred();
    mount(async () => true);
    let result!: Promise<boolean>;
    act(() => {
      result = recovery.resolveChoice(base, (snapshot) => {
        expect(snapshot).toEqual({
          localDraft: "my edits",
          localTitle: "",
        });
        return choice.promise;
      });
    });
    expect(recovery.state?.saving).toBe(true);
    act(() => {
      draft = "typing after the choice started";
      recovery.updateDraft(draft);
    });
    await act(async () => choice.resolve(true));
    expect(await result).toBe(false);
    expect(recovery.state).toEqual({
      reason: "conflict",
      localDraft: draft,
      localTitle: "",
      saving: false,
    });
  });

  it("does not let a secondary choice dismiss a newer recovery generation", async () => {
    const choice = deferred();
    mount(async () => true);
    let result!: Promise<boolean>;
    act(() => {
      result = recovery.resolveChoice(base, () => choice.promise);
    });
    act(() => {
      draft = "new conflict draft";
      recovery.report("conflict", draft);
    });
    await act(async () => choice.resolve(true));
    expect(await result).toBe(false);
    expect(recovery.state).toEqual({
      reason: "conflict",
      localDraft: draft,
      localTitle: "",
      saving: false,
    });
  });

  it("preserves newer typing when a secondary choice is rejected", async () => {
    const choice = deferred();
    mount(async () => true);
    let result!: Promise<boolean>;
    act(() => {
      result = recovery.resolveChoice(base, async () => {
        await choice.promise;
        throw new Error("offline");
      });
    });
    act(() => {
      draft = "typing before the request failed";
      recovery.updateDraft(draft);
    });
    await act(async () => choice.resolve(true));
    expect(await result).toBe(false);
    expect(recovery.state).toEqual({
      reason: "save-failed",
      localDraft: draft,
      localTitle: "",
      saving: false,
    });
  });

  it("durably retains typing added while a secondary choice resolves", async () => {
    const choice = deferred();
    const retain = vi.fn(async () => undefined);
    mount(async () => true, undefined, retain);
    let result!: Promise<boolean>;
    act(() => {
      result = recovery.resolveChoice(base, () => choice.promise);
    });
    act(() => {
      draft = "typing after the request started";
      recovery.updateDraft(draft);
    });
    await act(async () => choice.resolve(true));
    expect(await result).toBe(false);
    expect(retain).toHaveBeenCalledWith({
      localDraft: draft,
      localTitle: "",
    });
  });

  it("surfaces a failed background retention as retryable", () => {
    mount(async () => true);
    act(() => {
      recovery.reportRetentionFailure();
    });
    expect(recovery.state).toEqual({
      reason: "save-failed",
      localDraft: "my edits",
      localTitle: "",
      saving: false,
    });
  });

  it("blocks duplicate submissions and supports retry after a lost CAS", async () => {
    const first = deferred();
    const save = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(true);
    mount(save);
    let result!: Promise<boolean>;
    act(() => {
      result = recovery.resolve(base);
    });
    expect(await recovery.resolve(base)).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve(false));
    expect(await result).toBe(false);
    expect(recovery.state?.reason).toBe("conflict");
    await act(async () => {
      expect(await recovery.resolve(base)).toBe(true);
    });
    expect(recovery.state).toBeNull();
  });

  it("records a failed reconciliation separately and synchronously pauses edits", () => {
    mount(async () => true);
    act(() => {
      recovery.report("failed", draft);
      expect(recovery.updateDraft("newer draft")).toBe(true);
    });
    expect(recovery.state).toEqual({
      reason: "failed",
      localDraft: "newer draft",
      localTitle: "",
      saving: false,
    });
  });
});
