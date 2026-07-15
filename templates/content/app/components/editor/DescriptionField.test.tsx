// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

let textareaProps: Record<string, any> = {};

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: Record<string, any>) => {
    textareaProps = props;
    return null;
  },
}));

import {
  DescriptionField,
  descriptionFieldEscapeDraft,
  descriptionFieldSavedValue,
} from "./DescriptionField";

describe("DescriptionField behavior", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    textareaProps = {};
  });

  function render(onSave = vi.fn()) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        createElement(DescriptionField, {
          description: "Stable guidance",
          canEdit: true,
          onSave,
        }),
      );
    });
    return onSave;
  }

  it("saves a trimmed description only when it changed", () => {
    expect(descriptionFieldSavedValue("  Clear inclusion boundary  ", "")).toBe(
      "Clear inclusion boundary",
    );
    expect(
      descriptionFieldSavedValue(" Existing guidance ", "Existing guidance"),
    ).toBe(null);
  });

  it("restores the persisted description on Escape", () => {
    expect(descriptionFieldEscapeDraft("Stable guidance")).toBe(
      "Stable guidance",
    );
    expect(descriptionFieldEscapeDraft(undefined)).toBe("");
  });

  it("does not save the canceled draft when Escape immediately blurs", () => {
    const onSave = render();
    act(() => {
      textareaProps.onChange({ target: { value: "Canceled edit" } });
    });
    act(() => {
      textareaProps.onKeyDown({
        key: "Escape",
        preventDefault: vi.fn(),
        currentTarget: { blur: () => textareaProps.onBlur() },
      });
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(textareaProps.value).toBe("Stable guidance");
  });

  it("restores the stored value when a blur save fails", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("offline"));
    render(onSave);
    act(() => {
      textareaProps.onChange({ target: { value: "Unsent edit" } });
    });
    await act(async () => {
      textareaProps.onBlur();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith("Unsent edit");
    expect(textareaProps.value).toBe("Stable guidance");
  });

  it("serializes successive blur saves so the latest value persists last", async () => {
    let releaseFirstSave!: () => void;
    const firstSave = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    let markSecondSaveStarted!: () => void;
    const secondSaveStarted = new Promise<void>((resolve) => {
      markSecondSaveStarted = resolve;
    });
    const persistedValues: string[] = [];
    const onSave = vi.fn(async (value: string) => {
      if (value === "First edit") await firstSave;
      persistedValues.push(value);
      if (value === "Latest edit") markSecondSaveStarted();
    });
    render(onSave);

    act(() => {
      textareaProps.onChange({ target: { value: "First edit" } });
    });
    act(() => textareaProps.onBlur());
    act(() => {
      textareaProps.onFocus();
      textareaProps.onChange({ target: { value: "Latest edit" } });
    });
    act(() => textareaProps.onBlur());

    await Promise.resolve();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("First edit");

    releaseFirstSave();
    await firstSave;
    await secondSaveStarted;

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith("Latest edit");
    expect(persistedValues).toEqual(["First edit", "Latest edit"]);
  });

  it("restores the latest confirmed save when a queued save fails before props refresh", async () => {
    let markSecondSaveFinished!: () => void;
    const secondSaveFinished = new Promise<void>((resolve) => {
      markSecondSaveFinished = resolve;
    });
    const onSave = vi.fn(async (value: string) => {
      if (value === "Latest edit") {
        markSecondSaveFinished();
        throw new Error("offline");
      }
    });
    render(onSave);

    act(() => {
      textareaProps.onChange({ target: { value: "First edit" } });
    });
    act(() => textareaProps.onBlur());
    act(() => {
      textareaProps.onFocus();
      textareaProps.onChange({ target: { value: "Latest edit" } });
    });
    act(() => textareaProps.onBlur());

    await act(async () => {
      await secondSaveFinished;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenNthCalledWith(1, "First edit");
    expect(onSave).toHaveBeenNthCalledWith(2, "Latest edit");
    expect(textareaProps.value).toBe("First edit");
  });
});
