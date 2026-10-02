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
  mutateAsync: vi.fn(),
  mutationError: null as Error | null,
  useActionMutation: vi.fn(),
}));

vi.mock("../use-action.js", () => ({
  useActionQuery: mocks.useActionQuery,
  useActionMutation: mocks.useActionMutation,
}));

describe("useResourceAccessGate", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onAccessGranted = vi.fn();

  let gate: ReturnType<typeof useResourceAccessGate> | null = null;

  function Harness(props: ResourceAccessGateOptions) {
    gate = useResourceAccessGate(props);
    return null;
  }

  function render(
    status: ResourceAccessGateStatus | undefined,
    id = "doc-1",
    enabled = true,
  ) {
    mocks.data = status;
    act(() => {
      root.render(
        <Harness
          resourceType="document"
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
    mocks.useActionQuery.mockReset();
    mocks.useActionQuery.mockImplementation(() => ({
      data: mocks.data,
      isLoading: !mocks.data,
      isError: false,
      refetch: mocks.refetch,
    }));
    mocks.mutateAsync.mockReset();
    mocks.mutationError = null;
    mocks.useActionMutation.mockReset();
    mocks.useActionMutation.mockImplementation(() => ({
      mutateAsync: mocks.mutateAsync,
      isPending: false,
      error: mocks.mutationError,
    }));
    onAccessGranted.mockReset();
    gate = null;
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

  it("checks every half minute only while the viewer's request is open", () => {
    render({ state: "denied", canRequest: true });
    const options = mocks.useActionQuery.mock.calls[0][2];

    expect(
      options.refetchInterval({
        state: {
          data: {
            state: "denied",
            request: { state: "pending", requestedAt: "2026-10-02T12:00:00Z" },
          },
        },
      }),
    ).toBe(30_000);
    expect(
      options.refetchInterval({ state: { data: { state: "denied" } } }),
    ).toBe(false);
  });

  it("asks for access with a trimmed note, then checks the status again", async () => {
    render({ state: "denied", canRequest: true });

    await act(async () => {
      await gate!.requestAccess("  For Friday  ");
    });

    expect(mocks.useActionMutation).toHaveBeenCalledWith(
      "request-resource-access",
    );
    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      resourceType: "document",
      resourceId: "doc-1",
      note: "For Friday",
    });
    expect(mocks.refetch).toHaveBeenCalledWith({ cancelRefetch: false });

    await act(async () => {
      await gate!.requestAccess("   ");
    });
    expect(mocks.mutateAsync).toHaveBeenLastCalledWith({
      resourceType: "document",
      resourceId: "doc-1",
    });
  });

  it("explains a failed request with its code and retry time", () => {
    mocks.mutationError = Object.assign(new Error("Too many"), {
      errorCode: "access_request_rate_limited",
      details: { retryAt: "2026-10-03T12:00:00.000Z" },
    });
    render({ state: "denied", canRequest: true });

    expect(gate!.requestError).toEqual({
      errorCode: "access_request_rate_limited",
      retryAt: "2026-10-03T12:00:00.000Z",
    });
  });
});
