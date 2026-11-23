// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/toolkit/app/shared", () => ({
  AgentNativeIcon: () => <span />,
}));

import { i18nCatalog } from "@/i18n";
import { UNTITLED_PROJECT_NAME } from "@/lib/model/contracts";

import { ProjectHeader as View } from "./ProjectHeader";

function ProjectHeader(props: ComponentProps<typeof View>) {
  return (
    <MemoryRouter>
      <View {...props} />
    </MemoryRouter>
  );
}

const REACT_ACT_ENVIRONMENT = globalThis as {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
REACT_ACT_ENVIRONMENT.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function openProjectMenu() {
  const trigger = container?.querySelector('[aria-label="Project options"]');
  if (trigger == null) throw new Error("project menu trigger is missing");
  act(() => {
    trigger.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
  });
  const menu = document.querySelector(
    '[role="menu"][aria-label="Project options"]',
  );
  if (menu == null) throw new Error("project menu did not open");
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

function selectProjectMenuItem(items: HTMLElement[], label: string) {
  const item = items.find((item) => item.textContent?.trim() === label);
  if (item == null) throw new Error(`${label} menu item is missing`);
  act(() => item.click());
}

function TranslatedProjectHeader(props: ComponentProps<typeof View>) {
  return (
    <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
      <ProjectHeader {...props} />
    </AgentNativeI18nProvider>
  );
}

async function renderTranslated(props: ComponentProps<typeof View>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(<TranslatedProjectHeader {...props} />));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("ProjectHeader project options", () => {
  it("offers status and owner transfer next to rename", () => {
    const onStatus = vi.fn();
    const onTransfer = vi.fn();
    const onDuplicate = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <TranslatedProjectHeader
          title="QA project"
          canRename={true}
          onRename={async () => {}}
          onStatus={onStatus}
          onTransfer={onTransfer}
          onDuplicate={onDuplicate}
        />,
      );
    });

    const items = openProjectMenu();
    const labels = items.map((item) => item.textContent?.trim());
    expect(labels).toContain("Set status");
    expect(labels).toContain("Transfer project owner");
    expect(labels).toContain("Duplicate");
    // Source order: Duplicate sits directly under Rename.
    expect(labels.indexOf("Duplicate")).toBe(labels.indexOf("Rename") + 1);

    selectProjectMenuItem(items, "Set status");
    selectProjectMenuItem(openProjectMenu(), "Transfer project owner");
    selectProjectMenuItem(openProjectMenu(), "Duplicate");
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(onTransfer).toHaveBeenCalledTimes(1);
  });

  it("A2-PROJECT-MENU-CONTROLS invokes each project control", async () => {
    const exportYaml = vi.fn();
    const collection = vi.fn();
    const archive = vi.fn(async () => {});
    const newProject = vi.fn(async () => {});
    await renderTranslated({
      title: "QA project",
      canRename: true,
      onRename: async () => {},
      onExportYaml: exportYaml,
      onAddToCollection: collection,
      onArchive: archive,
      onNewProject: newProject,
    });
    const exportAs = openProjectMenu().find(
      (item) => item.textContent?.trim() === "Export as",
    );
    expect(exportAs).toBeDefined();
    await act(async () => exportAs?.click());
    const yaml = [
      ...document.querySelectorAll<HTMLElement>(
        '[role="menu"][aria-label="Export as"] [role="menuitem"]',
      ),
    ].find((item) => item.textContent?.trim() === "Analytics project (.yaml)");
    expect(yaml).toBeDefined();
    await act(async () => yaml?.click());
    selectProjectMenuItem(openProjectMenu(), "Add to collection");
    selectProjectMenuItem(openProjectMenu(), "Archive");
    selectProjectMenuItem(openProjectMenu(), "New project");
    expect(exportYaml).toHaveBeenCalledOnce();
    expect(collection).toHaveBeenCalledOnce();
    expect(archive).toHaveBeenCalledOnce();
    expect(newProject).toHaveBeenCalledOnce();
  });

  it.each(["Archive", "New project"])(
    "shows synchronous %s callback errors",
    async (label) => {
      const fail = () => {
        throw new Error("Menu callback failed");
      };
      await renderTranslated({
        title: "QA project",
        canRename: true,
        onRename: async () => {},
        onArchive: fail,
        onNewProject: fail,
      });
      const item = openProjectMenu().find(
        (node) => node.textContent?.trim() === label,
      );
      expect(item).toBeDefined();
      await act(async () => item?.click());
      expect(container?.textContent).toContain("Menu callback failed");
    },
  );

  it("shows an asynchronous project creation failure", async () => {
    await renderTranslated({
      title: "QA project",
      canRename: true,
      onRename: async () => {},
      onNewProject: async () => {
        throw new Error("Creation unavailable");
      },
    });
    const item = openProjectMenu().find(
      (node) => node.textContent?.trim() === "New project",
    );
    expect(item).toBeDefined();
    await act(async () => item?.click());
    expect(container?.textContent).toContain("Creation unavailable");
  });

  it("opens the export choices on hover", async () => {
    await renderTranslated({
      title: "QA project",
      canRename: true,
      onRename: async () => {},
      onExportYaml: () => {},
      onExportIpynb: () => {},
    });
    const item = openProjectMenu().find(
      (node) => node.textContent?.trim() === "Export as",
    );
    expect(item).toBeDefined();
    vi.useFakeTimers();
    try {
      await act(async () => {
        item?.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            pointerType: "mouse",
          }),
        );
        vi.runOnlyPendingTimers();
      });
    } finally {
      vi.useRealTimers();
    }
    const choices = document.querySelector(
      '[role="menu"][aria-label="Export as"]',
    )?.textContent;
    expect(choices).toContain("Analytics project (.yaml)");
    expect(choices).toContain("Jupyter notebook (.ipynb)");
  });

  // oracle-change: a blank title now cancels the rename and keeps the stored title instead of committing Untitled project, on Enter and on blur
  it("focuses Rename from the menu and commits a trimmed title on Enter exactly once", async () => {
    let resolveRename: (() => void) | undefined;
    const onRename = vi.fn(
      () => new Promise<void>((resolve) => (resolveRename = resolve)),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <ProjectHeader
          title="QA project"
          canRename={true}
          onRename={onRename}
        />,
      );
    });

    const items = openProjectMenu();
    vi.useFakeTimers();
    try {
      selectProjectMenuItem(items, "Rename");
      await act(async () => vi.runOnlyPendingTimers());
    } finally {
      vi.useRealTimers();
    }
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Project title"]',
    );
    if (input == null) throw new Error("project title input is missing");
    expect(document.activeElement).toBe(input);
    await changeTitle(input, "  Renamed project  ");
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith("Renamed project");
    if (resolveRename == null)
      throw new Error("rename promise was not started");
    await act(async () => resolveRename?.());
    expect(container.textContent).toContain("Renamed project");
  });

  it("keeps the stored title on a blank blur and opens a generated placeholder empty", async () => {
    const onRename = vi.fn(async () => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <ProjectHeader
          title="Existing title"
          canRename={true}
          onRename={onRename}
        />,
      );
    });

    const title = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Existing title",
    );
    if (title == null) throw new Error("project title button is missing");
    await act(async () => title.click());
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Project title"]',
    );
    if (input == null) throw new Error("project title input is missing");
    await changeTitle(input, "  ");
    await act(async () => input.blur());
    expect(onRename).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Existing title");

    await act(async () => {
      root?.render(
        <ProjectHeader
          title={UNTITLED_PROJECT_NAME}
          untitledOrdinal={1}
          canRename={true}
          onRename={onRename}
        />,
      );
    });
    const defaultTitle = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === UNTITLED_PROJECT_NAME,
    );
    if (defaultTitle == null)
      throw new Error("default project title is missing");
    await act(async () => defaultTitle.click());
    const unchangedInput = container.querySelector<HTMLInputElement>(
      '[aria-label="Project title"]',
    );
    if (unchangedInput == null)
      throw new Error("project title input is missing");
    expect(unchangedInput.value).toBe("");
    await act(async () => unchangedInput.blur());
    expect(onRename).not.toHaveBeenCalled();
    expect(container.textContent).toContain(UNTITLED_PROJECT_NAME);
  });

  it("keeps a title rename failure visible after Enter", async () => {
    const onRename = vi.fn(async () => {
      throw new Error("Rename unavailable");
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <ProjectHeader
          title="QA project"
          canRename={true}
          onRename={onRename}
        />,
      );
    });

    const title = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "QA project",
    );
    if (title == null) throw new Error("project title button is missing");
    await act(async () => title.click());
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Project title"]',
    );
    if (input == null) throw new Error("project title input is missing");
    await changeTitle(input, "Renamed project");
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Rename unavailable",
    );
  });

  it("restores focus to the title button when Escape cancels inline rename", async () => {
    const onRename = vi.fn(async () => {});
    await renderTranslated({
      title: "QA project",
      canRename: true,
      onRename,
    });

    const title = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.trim() === "QA project",
    );
    if (title == null) throw new Error("project title button is missing");
    await act(async () => title.click());

    const input = container?.querySelector<HTMLInputElement>(
      '[aria-label="Project title"]',
    );
    if (input == null) throw new Error("project title input is missing");
    expect(document.activeElement).toBe(input);

    await changeTitle(input, "Temporary draft");
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(onRename).not.toHaveBeenCalled();
    const restoredTitle = [
      ...(container?.querySelectorAll("button") ?? []),
    ].find((button) => button.textContent?.trim() === "QA project");
    expect(restoredTitle).toBeDefined();
    expect(document.activeElement).toBe(restoredTitle);
  });

  it("shows the character count in the header when editing a long title", async () => {
    await renderTranslated({
      title: "QA project",
      canRename: true,
      onRename: async () => {},
    });

    const title = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.trim() === "QA project",
    );
    if (title == null) throw new Error("project title button is missing");
    await act(async () => title.click());

    const input = container?.querySelector<HTMLInputElement>(
      '[aria-label="Project title"]',
    );
    if (input == null) throw new Error("project title input is missing");
    await changeTitle(input, "a".repeat(260));
    expect(container?.textContent).toContain("260/500");
  });
});

async function changeTitle(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

it("explains why export and rename are unavailable in a version preview", async () => {
  const exportYaml = vi.fn();
  await renderTranslated({
    title: "Project",
    canRename: false,
    onRename: async () => {},
    onExportYaml: exportYaml,
    isVersionPreview: true,
  } as ComponentProps<typeof View>);
  const items = openProjectMenu();
  const rename = items.find((item) => item.textContent.trim() === "Rename");
  const exportItem = items.find(
    (item) => item.textContent.trim() === "Export as",
  );
  if (!rename || !exportItem) throw new Error("Preview actions are missing");
  expect(rename.getAttribute("aria-disabled")).toBe("true");
  expect(exportItem.getAttribute("aria-disabled")).toBe("true");
  expect(exportItem.getAttribute("title")).toBe(
    "Cannot export a previous version. Exit version preview to export.",
  );
  expect(exportYaml).not.toHaveBeenCalled();
});
