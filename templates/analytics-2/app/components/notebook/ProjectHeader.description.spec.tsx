// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/toolkit/app/shared", () => ({
  AgentNativeIcon: () => <span />,
}));

import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

import { i18nCatalog } from "@/i18n";

import { ProjectHeader as View } from "./ProjectHeader";

function ProjectHeader(props: ComponentProps<typeof View>) {
  return (
    <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
      <MemoryRouter>
        <View {...props} />
      </MemoryRouter>
    </AgentNativeI18nProvider>
  );
}

const REACT_ACT_ENVIRONMENT = globalThis as {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
REACT_ACT_ENVIRONMENT.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  if (root != null) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

const base = {
  title: "Weekly revenue",
  canRename: false,
  onRename: async () => {},
};

describe("ProjectHeader description", () => {
  it("shows the saved description under the title", () => {
    const html = renderToStaticMarkup(
      <ProjectHeader {...base} description="Revenue by region" />,
    );
    expect(html).toContain("Revenue by region");
  });

  it("offers the source placeholder when the description is empty and editable", () => {
    const html = renderToStaticMarkup(
      <ProjectHeader
        {...base}
        canRename={true}
        description=""
        onSaveDescription={async () => {}}
      />,
    );
    expect(html).toContain("Add description...");
  });

  it("does not render a description row for a static project without one", () => {
    const html = renderToStaticMarkup(<ProjectHeader {...base} />);
    expect(html).not.toContain("Add description...");
  });

  it("commits a changed description on Enter once, after blur", async () => {
    let resolveSave: (() => void) | undefined;
    const onSaveDescription = vi.fn(
      () => new Promise<void>((resolve) => (resolveSave = resolve)),
    );
    await mountHeader({ onSaveDescription });
    clickDescription();
    const input = descriptionInput();
    changeValue(input, "  Revenue by region  ");

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onSaveDescription).toHaveBeenCalledTimes(1);
    expect(onSaveDescription).toHaveBeenCalledWith("Revenue by region");
    if (resolveSave == null) throw new Error("save promise was not started");
    await act(async () => resolveSave?.());
    expect(findDescriptionInput()).toBeNull();
    expect(container?.textContent).toContain("Revenue by region");
  });

  it("keeps Shift+Enter in the editor and saves once on blur", async () => {
    const onSaveDescription = vi.fn(async () => {});
    await mountHeader({ onSaveDescription });
    clickDescription();
    const input = descriptionInput();
    changeValue(input, "First line\nSecond line");

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(onSaveDescription).not.toHaveBeenCalled();
    expect(descriptionInput()).toBe(input);

    await act(async () => input.blur());
    expect(onSaveDescription).toHaveBeenCalledTimes(1);
    expect(onSaveDescription).toHaveBeenCalledWith("First line\nSecond line");
  });

  it("cancels on Escape and saves an explicitly cleared description", async () => {
    const onSaveDescription = vi.fn(async () => {});
    await mountHeader({ onSaveDescription });
    clickDescription();
    const input = descriptionInput();
    changeValue(input, "Unsaved change");

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onSaveDescription).not.toHaveBeenCalled();
    expect(container?.textContent).toContain("Saved description");

    clickDescription();
    const cleared = descriptionInput();
    changeValue(cleared, "");
    await act(async () => {
      cleared.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onSaveDescription).toHaveBeenCalledTimes(1);
    expect(onSaveDescription).toHaveBeenCalledWith("");
  });

  it("keeps a description save failure visible after Enter", async () => {
    const onSaveDescription = vi.fn(async () => {
      throw new Error("Description unavailable");
    });
    await mountHeader({ onSaveDescription });
    clickDescription();
    const input = descriptionInput();
    changeValue(input, "Updated description");

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onSaveDescription).toHaveBeenCalledTimes(1);
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain(
      "Description unavailable",
    );
  });
});

async function mountHeader(overrides: {
  description?: string;
  onSaveDescription: (description: string) => Promise<void>;
}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <ProjectHeader
        {...base}
        canRename={true}
        description={overrides.description ?? "Saved description"}
        onSaveDescription={overrides.onSaveDescription}
      />,
    );
  });
}

function clickDescription() {
  const button = [...(container?.querySelectorAll("button") ?? [])].find(
    (candidate) => candidate.textContent?.trim() === "Saved description",
  );
  if (button == null) throw new Error("description editor button is missing");
  act(() => button.click());
}

function descriptionInput() {
  const input = findDescriptionInput();
  if (input == null) throw new Error("description textarea is missing");
  return input;
}

function findDescriptionInput() {
  return (
    container?.querySelector<HTMLTextAreaElement>(
      '[aria-label="Project description"]',
    ) ?? null
  );
}

function changeValue(input: HTMLTextAreaElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
