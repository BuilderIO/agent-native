// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import { NewCollectionDialog } from "./NewCollectionDialog";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

afterEach(() => {
  document.body.innerHTML = "";
  callAction.mockReset();
});

function mount(onClose = () => {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<NewCollectionDialog onClose={onClose} />));
  return root;
}

function setValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
    element,
    value,
  );
  act(() => {
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const button = (name: string) =>
  [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === name,
  ) as HTMLButtonElement;

describe("NewCollectionDialog", () => {
  it("renders in the shared dialog with name, description and sharing controls", () => {
    const root = mount();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Create new collection");
    expect(dialog?.textContent).toContain("Name");
    expect(dialog?.textContent).toContain("Description");
    expect(dialog?.textContent).toContain("Share with workspace");
    expect(dialog?.textContent).toContain("Create collection");
    act(() => root.unmount());
  });

  it("returns focus to the control that opened it when it closes", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const root = mount();
    expect(document.activeElement).not.toBe(trigger);
    act(() => root.unmount());
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("creates with defaults only and sends no sharing", async () => {
    const root = mount();
    callAction.mockResolvedValue({});
    setValue(
      document.querySelector("input") as HTMLInputElement,
      "QA defaults",
    );
    await act(async () => {
      button("Create collection").click();
    });
    expect(callAction).toHaveBeenCalledWith("create-collection", {
      name: "QA defaults",
    });
    act(() => root.unmount());
  });

  it("hands the new collection's id to the caller so it can open the page", async () => {
    const onClose = vi.fn();
    const root = mount(onClose);
    callAction.mockResolvedValue({ id: "collection-new" });
    setValue(document.querySelector("input") as HTMLInputElement, "QA open");
    await act(async () => {
      button("Create collection").click();
    });
    expect(onClose).toHaveBeenCalledWith("collection-new");
    act(() => root.unmount());
  });

  it("sends the workspace toggle and added people with their roles", async () => {
    const root = mount();
    callAction.mockResolvedValue({});
    setValue(document.querySelector("input") as HTMLInputElement, "QA shared");
    act(() => {
      (document.querySelector('[role="switch"]') as HTMLElement).click();
    });
    setValue(
      document.querySelector('input[type="email"]') as HTMLInputElement,
      "Teammate@Example.test",
    );
    act(() => button("Add").click());
    await act(async () => {
      button("Create collection").click();
    });
    expect(callAction).toHaveBeenCalledWith("create-collection", {
      name: "QA shared",
      sharing: {
        workspaceRole: "member",
        users: [{ email: "teammate@example.test", role: "member" }],
      },
    });
    act(() => root.unmount());
  });

  it("does not drop an unadded email silently", async () => {
    const root = mount();
    setValue(document.querySelector("input") as HTMLInputElement, "QA pending");
    setValue(
      document.querySelector('input[type="email"]') as HTMLInputElement,
      "someone@example.test",
    );
    await act(async () => {
      button("Create collection").click();
    });
    expect(callAction).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("before creating");
    act(() => root.unmount());
  });

  it("sends the selected emoji to create-collection", async () => {
    const root = mount();
    callAction.mockResolvedValue({});
    setValue(document.querySelector("input") as HTMLInputElement, "QA metrics");
    const pickerTrigger = document.querySelector(
      'button[aria-label="Emoji"]',
    ) as HTMLButtonElement;
    act(() => {
      pickerTrigger.click();
    });
    const emojiChoice = document.querySelector(
      'button[aria-label="📊"]',
    ) as HTMLButtonElement;
    expect(emojiChoice).toBeTruthy();
    act(() => {
      emojiChoice.click();
    });
    await act(async () => {
      button("Create collection").click();
    });
    expect(callAction).toHaveBeenCalledWith("create-collection", {
      name: "QA metrics",
      emoji: "📊",
    });
    act(() => root.unmount());
  });
});
