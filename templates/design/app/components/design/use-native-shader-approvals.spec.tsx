// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.unmock("@/components/design/use-native-shader-approvals");
const query = vi.hoisted(() => ({
  data: undefined as unknown,
  error: null as unknown,
}));
const session = vi.hoisted(() => ({
  email: "viewer@example.test" as string | undefined,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: vi.fn(() => query),
  useSession: vi.fn(() => ({
    session: session.email ? { email: session.email } : null,
    isLoading: false,
  })),
}));
import { useActionQuery } from "@agent-native/core/client/hooks";

import { useNativeShaderApprovals } from "./use-native-shader-approvals";
const roots: ReturnType<typeof createRoot>[] = [];
function renderHook<P = Record<string, never>>(
  render: (props: P) => ReturnType<typeof useNativeShaderApprovals>,
  options?: { initialProps: P },
) {
  let props = options?.initialProps ?? ({} as P);
  const result = {
    current: undefined as unknown as ReturnType<
      typeof useNativeShaderApprovals
    >,
  };
  function Probe() {
    result.current = render(props);
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  function rerender(next?: P) {
    if (next) props = next;
    act(() => root.render(createElement(Probe)));
  }
  rerender();
  return { result, rerender };
}
const hash = "a".repeat(64);
function frame() {
  const node = document.createElement("iframe");
  document.body.append(node);
  return { node, post: vi.spyOn(node.contentWindow!, "postMessage") };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  query.data = undefined;
  query.error = null;
  session.email = "viewer@example.test";
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("normal canvas native shader approval bootstrap", () => {
  it("leaves anonymous previews unqueried and enables authenticated viewers", () => {
    session.email = undefined;
    const target = frame();
    const { result, rerender } = renderHook(() =>
      useNativeShaderApprovals({
        designId: "design",
        fileId: "file",
        enabled: true,
      }),
    );
    expect(useActionQuery).toHaveBeenLastCalledWith(
      "get-shader",
      expect.any(Object),
      { enabled: false },
    );
    act(() => result.current.syncFrame(target.node));
    expect(target.post).not.toHaveBeenCalled();

    session.email = "viewer@example.test";
    rerender();
    expect(useActionQuery).toHaveBeenLastCalledWith(
      "get-shader",
      expect.any(Object),
      { enabled: true },
    );
    act(() => result.current.syncFrame(target.node));
    expect(target.post).toHaveBeenLastCalledWith(
      { type: "native-shader-approvals", status: "pending" },
      "*",
    );
  });
  it("sends initial pending and ready updates only to registered target frames", () => {
    const target = frame();
    const unrelated = frame();
    const { result, rerender } = renderHook(() =>
      useNativeShaderApprovals({
        designId: "design",
        fileId: "file",
        enabled: true,
      }),
    );
    act(() => result.current.syncFrame(target.node));
    expect(target.post).toHaveBeenLastCalledWith(
      { type: "native-shader-approvals", status: "pending" },
      "*",
    );
    query.data = {
      designId: "design",
      fileId: "file",
      approvedDefinitionHashes: [hash],
    };
    rerender();
    expect(target.post).toHaveBeenLastCalledWith(
      { type: "native-shader-approvals", status: "ready", hashes: [hash] },
      "*",
    );
    query.data = {
      designId: "design",
      fileId: "file",
      approvedDefinitionHashes: [],
    };
    rerender();
    expect(target.post).toHaveBeenLastCalledWith(
      { type: "native-shader-approvals", status: "ready", hashes: [] },
      "*",
    );
    expect(unrelated.post).not.toHaveBeenCalled();
    expect(useActionQuery).toHaveBeenCalledWith(
      "get-shader",
      {
        format: "native-v2",
        source: { kind: "design-file", designId: "design", fileId: "file" },
      },
      { enabled: true },
    );
  });
  it("sends ready approvals to a newly loaded frame and distinguishes unreadable data", () => {
    query.data = {
      designId: "design",
      fileId: "file",
      approvedDefinitionHashes: [hash],
    };
    const { result, rerender } = renderHook(() =>
      useNativeShaderApprovals({
        designId: "design",
        fileId: "file",
        enabled: true,
      }),
    );
    const target = frame();
    act(() => result.current.syncFrame(target.node));
    expect(target.post).toHaveBeenLastCalledWith(
      { type: "native-shader-approvals", status: "ready", hashes: [hash] },
      "*",
    );
    query.data = { designId: "design", fileId: "file" };
    rerender();
    expect(target.post).toHaveBeenLastCalledWith(
      { type: "native-shader-approvals", status: "unreadable" },
      "*",
    );
    query.data = {
      designId: "design",
      fileId: "file",
      approvedDefinitionHashes: [hash],
    };
    query.error = new Error("failed read");
    rerender();
    expect(target.post).toHaveBeenLastCalledWith(
      { type: "native-shader-approvals", status: "unreadable" },
      "*",
    );
  });
  it("does not reuse another source's cached approvals or registered frames", () => {
    const target = frame();
    query.data = {
      designId: "design",
      fileId: "file",
      approvedDefinitionHashes: [hash],
    };
    const { result, rerender } = renderHook(
      ({ fileId }) =>
        useNativeShaderApprovals({ designId: "design", fileId, enabled: true }),
      { initialProps: { fileId: "file" } },
    );
    act(() => result.current.syncFrame(target.node));
    target.post.mockClear();
    rerender({ fileId: "other" });
    expect(target.post).not.toHaveBeenCalled();
    const other = frame();
    act(() => result.current.syncFrame(other.node));
    expect(other.post).toHaveBeenLastCalledWith(
      { type: "native-shader-approvals", status: "pending" },
      "*",
    );
  });
  it("forgets frames while disabled and waits for their next inline load", () => {
    query.data = {
      designId: "design",
      fileId: "file",
      approvedDefinitionHashes: [hash],
    };
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useNativeShaderApprovals({
          designId: "design",
          fileId: "file",
          enabled,
        }),
      { initialProps: { enabled: true } },
    );
    const target = frame();
    act(() => result.current.syncFrame(target.node));
    target.post.mockClear();
    rerender({ enabled: false });
    query.data = {
      designId: "design",
      fileId: "file",
      approvedDefinitionHashes: [],
    };
    rerender({ enabled: false });
    act(() => result.current.syncFrame(target.node));
    expect(target.post).not.toHaveBeenCalled();
    rerender({ enabled: true });
    expect(target.post).not.toHaveBeenCalled();
    act(() => result.current.syncFrame(target.node));
    expect(target.post).toHaveBeenLastCalledWith(
      { type: "native-shader-approvals", status: "ready", hashes: [] },
      "*",
    );
  });
  it("exposes only current verified hashes with a stable identity", () => {
    const { result, rerender } = renderHook(() =>
      useNativeShaderApprovals({
        designId: "design",
        fileId: "file",
        enabled: true,
      }),
    );
    const pending = result.current.approvedDefinitionHashes;
    expect(pending).toEqual([]);

    query.data = {
      designId: "design",
      fileId: "file",
      approvedDefinitionHashes: [hash],
    };
    rerender();
    const ready = result.current.approvedDefinitionHashes;
    expect(ready).toEqual([hash]);
    query.data = {
      designId: "design",
      fileId: "file",
      approvedDefinitionHashes: [hash],
    };
    rerender();
    expect(result.current.approvedDefinitionHashes).toBe(ready);

    session.email = undefined;
    rerender();
    expect(result.current.approvedDefinitionHashes).toBe(pending);
    session.email = "viewer@example.test";
    query.data = {
      designId: "other",
      fileId: "file",
      approvedDefinitionHashes: [hash],
    };
    rerender();
    expect(result.current.approvedDefinitionHashes).toBe(pending);
  });
});
