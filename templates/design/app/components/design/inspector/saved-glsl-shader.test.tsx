// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutateAsync: vi.fn() }),
  useActionQuery: () => ({}),
  callAction: vi.fn(),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import type { ShaderEditorContext } from "../shader-source-coordination";
import {
  findSavedGlslFill,
  useRemoveSavedGlslShader,
} from "./saved-glsl-shader";

const container = document.createElement("div");
let root: ReturnType<typeof createRoot>;
afterEach(() => {
  act(() => root?.unmount());
  container.replaceChildren();
  vi.unstubAllGlobals();
});

it("removes the selector-resolved saved fill from current source and preserves other mounts", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const stale =
    '<div class="target" data-agent-native-node-id="old" data-an-shader-fill="saved"></div>';
  let content =
    '<div class="target" data-agent-native-node-id="authored" data-an-shader-fill="saved"></div><div data-agent-native-node-id="other" data-an-shader-fill="saved"></div>';
  const context: ShaderEditorContext = {
    fileId: "file",
    nodeId: "runtime-projection",
    selector: ".target",
    content: stale,
    editSource: (transform) => {
      const changed = transform(content);
      if (changed.errors.length)
        return { status: "failed", error: changed.errors[0]! };
      content = changed.html;
      return { status: "applied" };
    },
  };
  expect(findSavedGlslFill(context)).not.toBeNull();
  let remove: ReturnType<typeof useRemoveSavedGlslShader>["remove"];
  function Harness() {
    remove = useRemoveSavedGlslShader(context).remove;
    return null;
  }
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
  let result: boolean | undefined;
  await act(async () => {
    result = await remove!("fill");
  });
  expect(result).toBe(true);
  const parsed = new DOMParser().parseFromString(content, "text/html");
  expect(
    parsed.querySelector(".target")?.hasAttribute("data-an-shader-fill"),
  ).toBe(false);
  expect(
    parsed
      .querySelector('[data-agent-native-node-id="other"]')
      ?.getAttribute("data-an-shader-fill"),
  ).toBe("saved");
});
