// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useResourceAccessGate,
  type ResourceAccessGateOptions,
  type ResourceAccessGateStatus,
} from "./useResourceAccessGate.js";

const mocks = vi.hoisted(() => ({
  data: undefined as ResourceAccessGateStatus | undefined,
  useActionQuery: vi.fn(),
}));

vi.mock("../use-action.js", () => ({
  useActionQuery: mocks.useActionQuery,
}));

describe("useResourceAccessGate", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onAccessGranted = vi.fn();

  function Harness(props: ResourceAccessGateOptions) {
    useResourceAccessGate(props);
    return null;
  }

  function render(status: ResourceAccessGateStatus | undefined, id = "doc-1") {
    mocks.data = status;
    act(() => {
      root.render(
        <Harness
          resourceType="document"
          resourceId={id}
          onAccessGranted={onAccessGranted}
        />,
      );
    });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.data = undefined;
    mocks.useActionQuery.mockReset();
    mocks.useActionQuery.mockImplementation(() => ({
      data: mocks.data,
      isLoading: !mocks.data,
      isError: false,
      refetch: vi.fn(),
    }));
    onAccessGranted.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("asks for the link's status and checks again on focus", () => {
    render(undefined);

    expect(mocks.useActionQuery).toHaveBeenCalledWith(
      "get-resource-access-status",
      { resourceType: "document", resourceId: "doc-1" },
      expect.objectContaining({ refetchOnWindowFocus: "always" }),
    );
  });

  it("reports access granted once the viewer can open what they couldn't", () => {
    render({ state: "denied" });
    expect(onAccessGranted).not.toHaveBeenCalled();

    render({ state: "allowed", role: "viewer" });
    expect(onAccessGranted).toHaveBeenCalledTimes(1);

    render({ state: "allowed", role: "viewer" });
    expect(onAccessGranted).toHaveBeenCalledTimes(1);
  });

  it("doesn't report access granted when the first answer is allowed", () => {
    render({ state: "allowed", role: "owner" });

    expect(onAccessGranted).not.toHaveBeenCalled();
  });

  it("starts over for a different link", () => {
    render({ state: "denied" }, "doc-1");
    render({ state: "allowed", role: "viewer" }, "doc-2");

    expect(onAccessGranted).not.toHaveBeenCalled();
  });
});
