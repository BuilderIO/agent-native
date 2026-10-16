// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refetch: vi.fn(),
  useActionQuery: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (...args: unknown[]) => mocks.useActionQuery(...args),
}));

vi.mock("../store", () => ({
  useWorkbench: () => ({
    state: {
      tabs: [
        {
          uri: "inline:design-1/screen.html",
          providerKey: "inline:design-1",
          path: "screen.html",
        },
      ],
      buffers: {},
    },
    api: { applyExternalRead: vi.fn() },
  }),
}));

import { BufferSyncGroup } from "./BufferSync";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.refetch.mockReset().mockResolvedValue({ data: undefined });
  mocks.useActionQuery.mockReset().mockReturnValue({
    data: undefined,
    refetch: mocks.refetch,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

describe("BufferSyncGroup", () => {
  it("refreshes inline files when the Code panel becomes active", () => {
    mocks.useActionQuery.mockReturnValue({
      data: { content: "<main />", versionHash: "saved" },
      refetch: mocks.refetch,
    });
    act(() => {
      root!.render(<BufferSyncGroup designId="design-1" active={false} />);
    });

    expect(mocks.useActionQuery).toHaveBeenCalledWith(
      "read-source-file",
      { designId: "design-1", path: "screen.html" },
      { enabled: false },
    );
    expect(mocks.refetch).not.toHaveBeenCalled();

    act(() => {
      root!.render(<BufferSyncGroup designId="design-1" active />);
    });

    expect(mocks.refetch).toHaveBeenCalledTimes(1);

    act(() => {
      root!.render(<BufferSyncGroup designId="design-1" active={false} />);
    });
    act(() => {
      root!.render(<BufferSyncGroup designId="design-1" active />);
    });

    expect(mocks.refetch).toHaveBeenCalledTimes(2);
  });

  it("refreshes cached inline files when Code mounts active", () => {
    mocks.useActionQuery.mockReturnValue({
      data: { content: "<main />", versionHash: "saved" },
      refetch: mocks.refetch,
    });

    act(() => {
      root!.render(<BufferSyncGroup designId="design-1" active />);
    });

    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });
});
