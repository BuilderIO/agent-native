/**
 * Regression test for the shader-preset apply bug: `usePersistShaderEdit`
 * previously read the source file via `useActionMutation("read-source-file")`,
 * which always POSTs. `read-source-file` is registered `http: { method: "GET" }`
 * (readOnly action) — the server's action-routes gate rejects any mismatched
 * method with `{ error: "Method not allowed. Use GET." }` (see
 * packages/core/src/server/action-routes.ts), so every apply failed before
 * the transform or the write ever ran.
 *
 * The fix calls `read-source-file` imperatively via `callAction(..., {
 * method: "GET" })` — the same convention the working code-workbench inline
 * provider uses (see code-workbench/workspace/inline-provider.ts and its
 * .test.ts). This test drives the real `usePersistShaderEdit` hook (via a
 * tiny host component + `renderToStaticMarkup`, consistent with
 * EditPanel.componentFileId.spec.tsx's no-jsdom pattern) and asserts:
 *
 *   1. read-source-file is called through `callAction` with `{ method: "GET" }`
 *      — never through `useActionMutation`.
 *   2. apply-source-edit is called afterward with the transformed HTML and
 *      the `expectedVersionHash` from the read.
 *   3. `onApplied` receives the write's fileId/content so the host editor
 *      syncs local/collab state.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callActionCalls: Array<{
  name: string;
  params: unknown;
  options: unknown;
}> = [];
const mutateAsyncCalls: Array<{ name: string; params: unknown }> = [];

const mockCallAction = vi.hoisted(() => vi.fn());
const mockUseActionMutation = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client", () => ({
  callAction: (...args: unknown[]) => mockCallAction(...args),
  useActionMutation: (...args: unknown[]) => mockUseActionMutation(...args),
  useActionQuery: () => ({ data: undefined, isLoading: false, error: null }),
  useT:
    () =>
    (key: string): string =>
      key,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import {
  isShaderWriteInFlight,
  usePersistShaderEdit,
  waitForShaderWriteToSettle,
} from "./GlslShaderPanel";

describe("usePersistShaderEdit (shader preset apply regression)", () => {
  let capturedPersist:
    | ((
        transform: (html: string) => { html: string; errors: string[] },
      ) => Promise<boolean>)
    | null = null;

  beforeEach(() => {
    callActionCalls.length = 0;
    mutateAsyncCalls.length = 0;
    capturedPersist = null;

    mockCallAction.mockReset();
    mockCallAction.mockImplementation(
      (name: string, params: unknown, options: unknown) => {
        callActionCalls.push({ name, params, options });
        if (name === "read-source-file") {
          return Promise.resolve({
            content: "<html><body></body></html>",
            versionHash: "v1",
            fileId: "file_1",
          });
        }
        throw new Error(`unexpected callAction: ${name}`);
      },
    );

    mockUseActionMutation.mockReset();
    mockUseActionMutation.mockImplementation((name: string) => ({
      mutateAsync: (params: unknown) => {
        mutateAsyncCalls.push({ name, params });
        if (name === "apply-source-edit") {
          return Promise.resolve({
            fileId: "file_1",
            updatedAt: "2026-07-06T00:00:00.000Z",
          });
        }
        throw new Error(`unexpected mutateAsync: ${name}`);
      },
    }));
  });

  function HookHost(props: {
    designId: string;
    fileId: string;
    onApplied: (fileId: string, content: string, updatedAt?: string) => void;
  }) {
    const { persist } = usePersistShaderEdit({
      designId: props.designId,
      fileId: props.fileId,
      onApplied: props.onApplied,
    });
    capturedPersist = persist;
    return null;
  }

  it("reads via callAction GET — never via useActionMutation — then writes via apply-source-edit", async () => {
    const onApplied = vi.fn();
    renderToStaticMarkup(
      createElement(HookHost, {
        designId: "design_1",
        fileId: "file_1",
        onApplied,
      }),
    );
    expect(capturedPersist).toBeTruthy();

    const ok = await capturedPersist!((html) => ({
      html: html.replace("</body>", "<canvas></canvas></body>"),
      errors: [],
    }));

    expect(ok).toBe(true);

    // 1. read-source-file must go through callAction with method: GET —
    // this is the exact bug: it must NOT be one of the useActionMutation
    // hooks the component created.
    const read = callActionCalls.find((c) => c.name === "read-source-file");
    expect(read).toBeTruthy();
    expect(read!.params).toEqual({ designId: "design_1", fileId: "file_1" });
    expect(read!.options).toEqual({ method: "GET" });

    expect(mutateAsyncCalls.some((c) => c.name === "read-source-file")).toBe(
      false,
    );

    // 2. apply-source-edit must run afterward with the transformed content
    // and the versionHash observed by the read.
    const write = mutateAsyncCalls.find((c) => c.name === "apply-source-edit");
    expect(write).toBeTruthy();
    expect(write!.params).toMatchObject({
      designId: "design_1",
      fileId: "file_1",
      edit: {
        kind: "full-replace",
        content: "<html><body><canvas></canvas></body></html>",
      },
      expectedVersionHash: "v1",
    });

    // 3. onApplied syncs the host editor's local/collab state.
    expect(onApplied).toHaveBeenCalledWith(
      "file_1",
      "<html><body><canvas></canvas></body></html>",
      "2026-07-06T00:00:00.000Z",
    );
  });

  it("does not call apply-source-edit when the transform reports errors", async () => {
    renderToStaticMarkup(
      createElement(HookHost, {
        designId: "design_1",
        fileId: "file_1",
        onApplied: vi.fn(),
      }),
    );

    const ok = await capturedPersist!(() => ({
      html: "",
      errors: ["GLSL source must define void main()"],
    }));

    expect(ok).toBe(false);
    expect(mutateAsyncCalls.some((c) => c.name === "apply-source-edit")).toBe(
      false,
    );
  });

  it("skips the write when the transform is a no-op (html unchanged)", async () => {
    renderToStaticMarkup(
      createElement(HookHost, {
        designId: "design_1",
        fileId: "file_1",
        onApplied: vi.fn(),
      }),
    );

    const ok = await capturedPersist!((html) => ({ html, errors: [] }));

    expect(ok).toBe(true);
    expect(mutateAsyncCalls.some((c) => c.name === "apply-source-edit")).toBe(
      false,
    );
  });
});

/**
 * Regression test for the cross-pipeline write-race data-loss bug: a shader
 * apply (this hook's persist()) and a base Fill "Add layer" / "Remove layer"
 * style commit (DesignEditor.tsx's commitVisualStyles) both eventually
 * rewrite the SAME per-file Yjs collab document through two independent
 * round trips — a diff-based server write here, and the host's own
 * synchronous full-document ydoc rewrite there. Verified (via a standalone
 * repro against the real applyShaderToHtml/applyVisualEdit/applyTextToYDoc
 * functions) that racing the two produces a corrupted, doubled document
 * (two concatenated <!DOCTYPE>...</html> copies), not a clean overwrite.
 *
 * `isShaderWriteInFlight`/`waitForShaderWriteToSettle` are the exclusion
 * primitives DesignEditor.tsx's commitVisualStyles checks before doing its
 * own competing write. These tests exercise the registry directly (not a
 * mocked stand-in) so a regression in the ordering/clearing logic itself
 * would fail here, independent of any DesignEditor.tsx wiring.
 */
describe("shader write-race exclusion registry (isShaderWriteInFlight / waitForShaderWriteToSettle)", () => {
  beforeEach(() => {
    callActionCalls.length = 0;
    mutateAsyncCalls.length = 0;
  });

  function HookHost(props: {
    designId: string;
    fileId: string;
    onApplied: (fileId: string, content: string, updatedAt?: string) => void;
  }) {
    const { persist } = usePersistShaderEdit({
      designId: props.designId,
      fileId: props.fileId,
      onApplied: props.onApplied,
    });
    (HookHost as unknown as { persist?: typeof persist }).persist = persist;
    return null;
  }

  it("reports in-flight while apply-source-edit is pending and clears once onApplied has already fired", async () => {
    let resolveApplyEdit!: (value: {
      fileId: string;
      updatedAt: string;
    }) => void;
    const applyEditPromise = new Promise<{ fileId: string; updatedAt: string }>(
      (resolve) => {
        resolveApplyEdit = resolve;
      },
    );

    mockCallAction.mockReset();
    mockCallAction.mockImplementation((name: string) => {
      if (name === "read-source-file") {
        return Promise.resolve({
          content: "<html><body></body></html>",
          versionHash: "v1",
          fileId: "file_race",
        });
      }
      throw new Error(`unexpected callAction: ${name}`);
    });
    mockUseActionMutation.mockReset();
    mockUseActionMutation.mockImplementation((name: string) => ({
      mutateAsync: () => {
        if (name === "apply-source-edit") return applyEditPromise;
        throw new Error(`unexpected mutateAsync: ${name}`);
      },
    }));

    let onAppliedCalledBeforeSettle = false;
    const onApplied = vi.fn(() => {
      onAppliedCalledBeforeSettle = isShaderWriteInFlight("file_race");
    });

    renderToStaticMarkup(
      createElement(HookHost, {
        designId: "design_1",
        fileId: "file_race",
        onApplied,
      }),
    );
    const persist = (
      HookHost as unknown as { persist: (t: any) => Promise<boolean> }
    ).persist;

    expect(isShaderWriteInFlight("file_race")).toBe(false);

    const persistPromise = persist((html: string) => ({
      html: html.replace("</body>", "<canvas></canvas></body>"),
      errors: [],
    }));

    // Give the read-source-file microtask a tick to run so persist() has
    // registered its write in the shaderWriteLocks registry.
    await Promise.resolve();
    await Promise.resolve();
    expect(isShaderWriteInFlight("file_race")).toBe(true);

    const settlePromise = waitForShaderWriteToSettle("file_race");

    resolveApplyEdit({
      fileId: "file_race",
      updatedAt: "2026-07-06T00:00:00.000Z",
    });
    await settlePromise;

    // onApplied (the host-sync callback) must have already run by the time
    // waitForShaderWriteToSettle resolves — a caller that awaits this before
    // computing its own baseContent always sees the shader's synced content,
    // never a pre-shader snapshot.
    expect(onApplied).toHaveBeenCalled();
    expect(isShaderWriteInFlight("file_race")).toBe(false);
    // Sanity: onApplied observed the write as still "in flight" from its own
    // vantage point (called from inside the locked persist body), confirming
    // the registry entry spans the full read -> write -> onApplied sequence,
    // not just the network calls.
    expect(onAppliedCalledBeforeSettle).toBe(true);

    await expect(persistPromise).resolves.toBe(true);
  });

  it("serializes two overlapping persists for the same file (second awaits the first)", async () => {
    const callOrder: string[] = [];
    let resolveFirstRead!: () => void;
    const firstReadGate = new Promise<void>((resolve) => {
      resolveFirstRead = resolve;
    });

    mockCallAction.mockReset();
    let readCount = 0;
    mockCallAction.mockImplementation(async (name: string) => {
      if (name === "read-source-file") {
        readCount += 1;
        const thisRead = readCount;
        callOrder.push(`read-start-${thisRead}`);
        if (thisRead === 1) await firstReadGate;
        callOrder.push(`read-end-${thisRead}`);
        return {
          content: `<html><body>v${thisRead}</body></html>`,
          versionHash: `v${thisRead}`,
          fileId: "file_serial",
        };
      }
      throw new Error(`unexpected callAction: ${name}`);
    });
    mockUseActionMutation.mockReset();
    mockUseActionMutation.mockImplementation((name: string) => ({
      mutateAsync: (params: { edit: { content: string } }) => {
        if (name === "apply-source-edit") {
          callOrder.push(`write-${params.edit.content}`);
          return Promise.resolve({
            fileId: "file_serial",
            updatedAt: "2026-07-06T00:00:00.000Z",
          });
        }
        throw new Error(`unexpected mutateAsync: ${name}`);
      },
    }));

    renderToStaticMarkup(
      createElement(HookHost, {
        designId: "design_1",
        fileId: "file_serial",
        onApplied: vi.fn(),
      }),
    );
    const persist = (
      HookHost as unknown as { persist: (t: any) => Promise<boolean> }
    ).persist;

    const first = persist((html: string) => ({
      html: html.replace("v1", "v1-shader"),
      errors: [],
    }));
    // Second persist starts while the first's read-source-file is still
    // gated — it must NOT begin its own read until the first has fully
    // settled (including its write), or the two would compute against the
    // same stale base and race exactly like the reported bug.
    const second = persist((html: string) => ({
      html: html.replace("v2", "v2-shader"),
      errors: [],
    }));

    resolveFirstRead();
    await Promise.all([first, second]);

    expect(callOrder).toEqual([
      "read-start-1",
      "read-end-1",
      "write-<html><body>v1-shader</body></html>",
      "read-start-2",
      "read-end-2",
      "write-<html><body>v2-shader</body></html>",
    ]);
  });
});
