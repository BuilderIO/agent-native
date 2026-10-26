// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useNativeShaderPropertyDraft } from "./native-shader-property-draft";

describe("native property draft preview", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let field: ReturnType<typeof useNativeShaderPropertyDraft<number>>;
  const onPreview = vi.fn();
  let onCommit: ReturnType<typeof vi.fn<(value: number) => Promise<boolean>>>;

  function Harness({ value }: { value: number }) {
    field = useNativeShaderPropertyDraft(value, onCommit, onPreview);
    return <span>{field.draft}</span>;
  }

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    onPreview.mockReset();
    onCommit = vi.fn(async () => true);
    await act(async () => root.render(<Harness value={1} />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("restores the baseline on cancel without writing source", async () => {
    await act(async () => field.preview(2));
    expect(onPreview).toHaveBeenLastCalledWith(2);
    expect(host.textContent).toBe("2");
    await act(async () => field.cancel());
    expect(onPreview).toHaveBeenLastCalledWith(1);
    expect(host.textContent).toBe("1");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("shows the saved paint after closing during a pending successful commit", async () => {
    let resolveSave: (saved: boolean) => void = () => {
      throw new Error("No pending save");
    };
    onCommit.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSave = resolve;
        }),
    );
    await act(async () => field.commit(2));
    await act(async () => field.cancel());
    expect(onPreview).toHaveBeenLastCalledWith(1);
    await act(async () => resolveSave(true));
    expect(onPreview).toHaveBeenLastCalledWith(2);
    expect(host.textContent).toBe("2");
    await act(async () => field.cancel());
    expect(host.textContent).toBe("2");
  });

  it("does not replace a newer preview when the earlier commit finishes", async () => {
    let resolveSave: (saved: boolean) => void = () => {
      throw new Error("No pending save");
    };
    onCommit.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSave = resolve;
        }),
    );
    await act(async () => field.commit(2));
    await act(async () => field.preview(3));
    await act(async () => resolveSave(true));
    expect(onPreview).toHaveBeenLastCalledWith(3);
    expect(host.textContent).toBe("3");
    await act(async () => field.cancel());
    expect(onPreview).toHaveBeenLastCalledWith(2);
    expect(host.textContent).toBe("2");
  });

  it("keeps a newer commit when an earlier save fails", async () => {
    let rejectFirst: (error: Error) => void = () => {
      throw new Error("No pending save");
    };
    onCommit.mockImplementationOnce(
      () =>
        new Promise<boolean>((_, reject) => {
          rejectFirst = reject;
        }),
    );
    await act(async () => field.commit(2));
    await act(async () => field.commit(3));
    await act(async () => rejectFirst(new Error("Earlier save failed")));
    expect(host.textContent).toBe("3");
    expect(onPreview).toHaveBeenLastCalledWith(3);
    await act(async () => field.cancel());
    expect(onPreview).toHaveBeenLastCalledWith(3);
    expect(host.textContent).toBe("3");
  });

  it("keeps a newer color draft through stale source renders and an earlier save echo", async () => {
    type Color = { hex: string; alpha: number };
    let colorField!: ReturnType<typeof useNativeShaderPropertyDraft<Color>>;
    const saves: Array<(saved: boolean) => void> = [];
    const saveColor = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          saves.push(resolve);
        }),
    );
    function ColorHarness({ value }: { value: Color }) {
      colorField = useNativeShaderPropertyDraft(value, saveColor);
      return <span>{`${colorField.draft.hex}/${colorField.draft.alpha}`}</span>;
    }
    const original = { hex: "old", alpha: 1 };
    await act(async () => root.render(<ColorHarness value={original} />));
    await act(async () => colorField.commit({ hex: "new", alpha: 1 }));
    await act(async () =>
      root.render(<ColorHarness value={{ ...original }} />),
    );
    expect(host.textContent).toBe("new/1");

    await act(async () => saves[0]!(true));
    await act(async () =>
      root.render(<ColorHarness value={{ ...original }} />),
    );
    expect(host.textContent).toBe("new/1");

    await act(async () => colorField.commit({ hex: "new", alpha: 0.65 }));
    await act(async () =>
      root.render(<ColorHarness value={{ hex: "new", alpha: 1 }} />),
    );
    expect(host.textContent).toBe("new/0.65");

    await act(async () => saves[1]!(true));
    await act(async () =>
      root.render(<ColorHarness value={{ hex: "new", alpha: 0.65 }} />),
    );
    expect(host.textContent).toBe("new/0.65");

    await act(async () =>
      root.render(<ColorHarness value={{ hex: "new", alpha: 1 }} />),
    );
    expect(host.textContent).toBe("new/1");

    await act(async () =>
      root.render(<ColorHarness value={{ hex: "external", alpha: 0.2 }} />),
    );
    expect(host.textContent).toBe("external/0.2");
  });

  it("rolls back a failed second edit to the latest confirmed local color", async () => {
    type Color = { hex: string; alpha: number };
    let colorField!: ReturnType<typeof useNativeShaderPropertyDraft<Color>>;
    let failSecond: (saved: boolean) => void = () => {
      throw new Error("No pending save");
    };
    const saveColor = vi
      .fn<(value: Color) => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            failSecond = resolve;
          }),
      );
    function ColorHarness({ value }: { value: Color }) {
      colorField = useNativeShaderPropertyDraft(value, saveColor);
      return <span>{`${colorField.draft.hex}/${colorField.draft.alpha}`}</span>;
    }
    const original = { hex: "old", alpha: 1 };
    await act(async () => root.render(<ColorHarness value={original} />));
    await act(async () => colorField.commit({ hex: "new", alpha: 1 }));
    await act(async () =>
      root.render(<ColorHarness value={{ ...original }} />),
    );
    await act(async () => colorField.commit({ hex: "new", alpha: 0.65 }));
    await act(async () => failSecond(false));
    expect(host.textContent).toBe("new/1");
  });

  it("restores the latest published value when a pending edit fails", async () => {
    let resolveSave: (saved: boolean) => void = () => {
      throw new Error("No pending save");
    };
    onCommit.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSave = resolve;
        }),
    );
    await act(async () => field.commit(2));
    await act(async () => root.render(<Harness value={4} />));
    await act(async () => resolveSave(false));
    expect(host.textContent).toBe("4");
    expect(onPreview).toHaveBeenLastCalledWith(2);
  });

  it("clears unsaved preview on unmount and ignores the later failed save", async () => {
    let resolveSave: (saved: boolean) => void = () => {
      throw new Error("No pending save");
    };
    onCommit.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSave = resolve;
        }),
    );
    await act(async () => field.commit(2));
    await act(async () => root.render(null));
    expect(onPreview).toHaveBeenLastCalledWith(1);
    const calls = onPreview.mock.calls.length;
    await act(async () => resolveSave(false));
    expect(onPreview).toHaveBeenCalledTimes(calls);
  });
});
