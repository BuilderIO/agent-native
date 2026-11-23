// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

import { NewComponentDialog } from "./NewComponentDialog";

function setup(
  onCreate: (name: string) => Promise<{ omittedOutputs?: number } | void>,
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const mount = document.createElement("div");
  document.body.append(mount);
  const root = createRoot(mount);
  const onClose = vi.fn();
  const render = () =>
    act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <NewComponentDialog
            cellCount={3}
            onCreate={onCreate}
            onClose={onClose}
          />
        </AgentNativeI18nProvider>,
      ),
    );
  const type = async (value: string) =>
    act(async () => {
      const input =
        document.querySelector<HTMLInputElement>(".nb-component-name");
      if (input === null) throw new Error("name field missing");
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const submit = () =>
    act(async () => {
      document
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
  const done = async () => {
    await act(async () => root.unmount());
    mount.remove();
  };
  return { render, type, submit, done, onClose };
}

it("needs a name, saves the trimmed name once, and closes", async () => {
  const onCreate = vi.fn(async () => {});
  const ui = setup(onCreate);
  try {
    await ui.render();
    expect(document.body.textContent).toContain("Save these 3 cells");
    await ui.submit();
    expect(onCreate).not.toHaveBeenCalled();
    await ui.type("  Revenue block  ");
    await ui.submit();
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith("Revenue block");
    expect(ui.onClose).toHaveBeenCalledTimes(1);
  } finally {
    await ui.done();
  }
});

it("keeps the dialog open and shows the reason when saving fails", async () => {
  const ui = setup(async () => {
    throw new Error("That name is already used.");
  });
  try {
    await ui.render();
    await ui.type("Dup");
    await ui.submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "That name is already used.",
    );
    expect(ui.onClose).not.toHaveBeenCalled();
  } finally {
    await ui.done();
  }
});

it("says results were left out instead of closing quietly, and closes on Done", async () => {
  const ui = setup(async () => ({ omittedOutputs: 2 }));
  try {
    await ui.render();
    await ui.type("Partial");
    await ui.submit();
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "Some results were left out",
    );
    expect(ui.onClose).not.toHaveBeenCalled();
    const done = [...document.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Done",
    );
    await act(async () => done?.click());
    expect(ui.onClose).toHaveBeenCalledTimes(1);
  } finally {
    await ui.done();
  }
});

it("report QA-1795073405 the dialog is titled New component and failures end with the retry guidance", async () => {
  const ui = setup(async () => {
    throw new Error("Creation failed");
  });
  try {
    await ui.render();
    const title = document.querySelector('[role="dialog"] h2');
    expect(title?.textContent).toBe("New component");
    await ui.type("Dup");
    await ui.submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Creation failed. Try again, or contact support if the issue persists.",
    );
  } finally {
    await ui.done();
  }
});

it("report QA-1795073405 previews included cells and locks inputs/cancel while creating", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const mount = document.createElement("div");
  document.body.append(mount);
  const root = createRoot(mount);
  const onClose = vi.fn();
  let releaseCreate: (() => void) | undefined;
  const onCreate = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        releaseCreate = resolve;
      }),
  );
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <NewComponentDialog
            cellCount={2}
            cells={[
              { id: "c1", kind: "sql", label: "Orders query" },
              { id: "c2", kind: "chart", label: "Revenue chart" },
            ]}
            onCreate={onCreate}
            onClose={onClose}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    const preview = document.querySelector(
      '[data-testid="component-selected-cells"]',
    );
    expect(preview?.textContent).toContain("Orders query");
    expect(preview?.textContent).toContain("Revenue chart");

    const input =
      document.querySelector<HTMLInputElement>(".nb-component-name");
    if (!input) throw new Error("name field missing");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(input, "Revenue block");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      document
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    const cancel = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Cancel",
    );
    expect(input.disabled).toBe(true);
    expect(cancel?.disabled).toBe(true);
    await act(async () => cancel?.click());
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      releaseCreate?.();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    mount.remove();
  }
});
