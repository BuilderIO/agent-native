// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const callAction = vi.fn();
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => callAction(...args),
}));
vi.mock("@agent-native/core/client/i18n", async () => {
  const messages = (await import("../../i18n/en-US")).default as Record<
    string,
    unknown
  >;
  const lookup = (key: string): string => {
    let node: unknown = messages;
    for (const part of key.split(".")) {
      node = (node as Record<string, unknown> | undefined)?.[part];
    }
    return typeof node === "string" ? node : key;
  };
  return {
    useT: () => (key: string, values?: Record<string, string>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, value),
        lookup(key),
      ),
  };
});

import { DeleteCollectionDialog } from "./DeleteCollectionDialog";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

describe("DeleteCollectionDialog while deleting", () => {
  it("ignores Escape and Cancel and sends the delete once", async () => {
    callAction.mockReturnValue(new Promise(() => {}));
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <DeleteCollectionDialog
          collectionId="c1"
          collectionName="QA"
          onClose={onClose}
          onDeleted={() => {}}
        />,
      ),
    );
    const button = (name: string) =>
      [...container.querySelectorAll("button")].find(
        (candidate) => candidate.textContent === name,
      ) as HTMLButtonElement;
    await act(async () => {
      button("Delete collection").click();
      button("Delete collection").click();
    });
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(callAction).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(button("Cancel").disabled).toBe(true);
    await act(async () => root.unmount());
  });
});
