// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useImageModelMenu } from "./use-image-model-menu";

const { invalidateQueries, mutate, writeClientAppState } = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  mutate: vi.fn(),
  writeClientAppState: vi.fn(() => Promise.resolve()),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  readClientAppState: () => Promise.resolve(null),
  useActionMutation: () => ({ mutate }),
  writeClientAppState,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

describe("useImageModelMenu", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("dismisses stale failed candidates when the image model changes", () => {
    let menu: ReturnType<typeof useImageModelMenu> | undefined;
    function Harness() {
      menu = useImageModelMenu("thread-1");
      return null;
    }

    act(() => root.render(<Harness />));
    act(() => menu?.onChange("gpt-image-2"));

    expect(writeClientAppState).toHaveBeenCalledWith("imageGenerationModel", {
      model: "gpt-image-2",
    });
    expect(mutate).toHaveBeenCalledWith(
      { scope: "failed", threadId: "thread-1" },
      expect.any(Object),
    );
  });

  it("does not dismiss unscoped candidates from a sidebar without a thread", () => {
    let menu: ReturnType<typeof useImageModelMenu> | undefined;
    function Harness() {
      menu = useImageModelMenu();
      return null;
    }

    act(() => root.render(<Harness />));
    act(() => menu?.onChange("gpt-image-2"));

    expect(writeClientAppState).toHaveBeenCalledWith("imageGenerationModel", {
      model: "gpt-image-2",
    });
    expect(mutate).not.toHaveBeenCalled();
  });
});
