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
  refetch: vi.fn(),
  useActionQuery: vi.fn(),
  forgetAuthFailures: vi.fn(),
}));

vi.mock("../use-action.js", () => ({
  useActionQuery: mocks.useActionQuery,
}));
vi.mock("../embed-auth.js", () => ({
  forgetAuthFailures: mocks.forgetAuthFailures,
}));

describe("useResourceAccessGate", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onAccessGranted = vi.fn();

  function Harness(props: ResourceAccessGateOptions) {
    useResourceAccessGate(props);
    return null;
  }

  function render(
    status: ResourceAccessGateStatus | undefined,
    id = "doc-1",
    enabled = true,
    type = "document",
  ) {
    mocks.data = status;
    act(() => {
      root.render(
        <Harness
          resourceType={type}
          resourceId={id}
          enabled={enabled}
          onAccessGranted={onAccessGranted}
        />,
      );
    });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.data = undefined;
    mocks.refetch.mockReset();
    mocks.forgetAuthFailures.mockReset();
    mocks.useActionQuery.mockReset();
    mocks.useActionQuery.mockImplementation(() => ({
      data: mocks.data,
      isLoading: !mocks.data,
      isError: false,
      refetch: mocks.refetch,
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

  it("reports access granted once when the first answer is allowed", () => {
    render({ state: "allowed", role: "owner" });
    render({ state: "allowed", role: "owner" });

    expect(onAccessGranted).toHaveBeenCalledTimes(1);
  });

  it("starts over for a different link", () => {
    render({ state: "allowed", role: "viewer" }, "doc-1");
    render({ state: "denied" }, "doc-2");
    expect(onAccessGranted).toHaveBeenCalledTimes(1);

    render({ state: "allowed", role: "viewer" }, "doc-2");
    expect(onAccessGranted).toHaveBeenCalledTimes(2);
  });

  it("starts over for a different kind of resource with the same id", () => {
    render({ state: "allowed", role: "viewer" }, "shared-id", true, "document");
    render({ state: "allowed", role: "viewer" }, "shared-id", true, "deck");

    expect(onAccessGranted).toHaveBeenCalledTimes(2);
  });

  it("forgets replayed refusals before the read is tried again", () => {
    onAccessGranted.mockImplementation(() => {
      expect(mocks.forgetAuthFailures).toHaveBeenCalledTimes(1);
    });
    render({ state: "denied" });
    expect(mocks.forgetAuthFailures).not.toHaveBeenCalled();

    render({ state: "allowed", role: "viewer" });

    expect(onAccessGranted).toHaveBeenCalledTimes(1);
  });

  it("checks again when focus returns from another window", () => {
    render({ state: "denied" });

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(mocks.refetch).toHaveBeenCalledWith({ cancelRefetch: false });
  });

  it("doesn't check on focus while disabled", () => {
    render(undefined, "doc-1", false);

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(mocks.refetch).not.toHaveBeenCalled();
  });
});
