// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import type { Project } from "@/lib/model/contracts";

import { RenameProjectDialog } from "./RenameProjectDialog";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

const SAMPLE_PROJECT = {
  id: "proj-1",
  title: "Quarterly ARR",
} as Project;

describe("RenameProjectDialog focus management", () => {
  it("focuses the input on open and restores focus to the opener on close", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Rename";
    document.body.append(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <RenameProjectDialog
            project={SAMPLE_PROJECT}
            onRename={vi.fn(async () => undefined)}
            onClose={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      );
    });

    const input = container.querySelector("input") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);

    await act(async () => {
      root.unmount();
    });

    expect(document.activeElement).toBe(opener);
  });

  it("syncs title when project changes, disables Cancel while pending, and shows CharacterCount", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    let resolveRename: (() => void) | undefined;
    const onRename = vi.fn(
      () => new Promise<void>((resolve) => (resolveRename = resolve)),
    );

    const renderDialog = async (project: Project) => {
      await act(async () => {
        root.render(
          <AgentNativeI18nProvider
            catalog={{ messages: enUS }}
            persistPreference={false}
          >
            <RenameProjectDialog
              project={project}
              onRename={onRename}
              onClose={vi.fn()}
            />
          </AgentNativeI18nProvider>,
        );
      });
    };

    await renderDialog(SAMPLE_PROJECT);
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("Quarterly ARR");

    await renderDialog({ id: "proj-2", title: "Weekly Churn" } as Project);
    expect(input.value).toBe("Weekly Churn");

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "a".repeat(260));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("260/500");

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    const cancelButton = [...container.querySelectorAll("button")].find(
      (btn) => btn.textContent?.trim() === "Cancel",
    ) as HTMLButtonElement;
    expect(cancelButton.disabled).toBe(true);

    await act(async () => {
      resolveRename?.();
    });
    await act(async () => {
      root.unmount();
    });
  });
});
