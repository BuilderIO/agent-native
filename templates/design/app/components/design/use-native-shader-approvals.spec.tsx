// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.unmock("@/components/design/use-native-shader-approvals");
const query = vi.hoisted(() => ({
  data: undefined as unknown,
  error: null as unknown,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: vi.fn(() => query),
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
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("normal canvas native shader approval bootstrap", () => {
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
    act(() => result.current(target.node));
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
    act(() => result.current(target.node));
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
    act(() => result.current(target.node));
    target.post.mockClear();
    rerender({ fileId: "other" });
    expect(target.post).not.toHaveBeenCalled();
    const other = frame();
    act(() => result.current(other.node));
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
    act(() => result.current(target.node));
    target.post.mockClear();
    rerender({ enabled: false });
    query.data = {
      designId: "design",
      fileId: "file",
      approvedDefinitionHashes: [],
    };
    rerender({ enabled: false });
    act(() => result.current(target.node));
    expect(target.post).not.toHaveBeenCalled();
    rerender({ enabled: true });
    expect(target.post).not.toHaveBeenCalled();
    act(() => result.current(target.node));
    expect(target.post).toHaveBeenLastCalledWith(
      { type: "native-shader-approvals", status: "ready", hashes: [] },
      "*",
    );
  });
});
