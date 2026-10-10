// @vitest-environment jsdom
import { act, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { useNativeSceneExportAbort } from "./use-native-scene-export-abort";

describe("native scene export ownership", () => {
  it("cancels a running local export when the selected Design changes or unmounts", async () => {
    let controller: RefObject<AbortController | null> | null = null;
    function Harness({ id }: { id: string }) {
      controller = useNativeSceneExportAbort(id);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Harness id="design-1" />));
    const first = new AbortController();
    controller!.current = first;
    await act(async () => root.render(<Harness id="design-2" />));
    expect(first.signal.aborted).toBe(true);

    const second = new AbortController();
    controller!.current = second;
    await act(async () => root.unmount());
    expect(second.signal.aborted).toBe(true);
  });
});
