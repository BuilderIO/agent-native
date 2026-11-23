// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";

vi.mock("@agent-native/toolkit/app/shared", () => ({
  AgentNativeIcon: () => <span />,
}));

vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const SubContext = React.createContext<{ open: boolean; show: () => void }>({
    open: false,
    show: () => {},
  });
  return {
    DropdownMenu: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
    DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
      <>{children}</>
    ),
    DropdownMenuContent: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
    DropdownMenuSub: ({ children }: { children: ReactNode }) => {
      const [open, setOpen] = React.useState(false);
      return (
        <SubContext.Provider value={{ open, show: () => setOpen(true) }}>
          {children}
        </SubContext.Provider>
      );
    },
    DropdownMenuSubTrigger: ({ children }: { children: ReactNode }) => {
      const { show } = React.useContext(SubContext);
      return (
        <button role="menuitem" onClick={show} onMouseEnter={show}>
          {children}
        </button>
      );
    },
    DropdownMenuSubContent: ({ children }: { children: ReactNode }) =>
      React.useContext(SubContext).open ? <div>{children}</div> : null,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuItem: ({
      children,
      onSelect,
      disabled,
    }: {
      children: ReactNode;
      onSelect?: () => void;
      disabled?: boolean;
    }) => (
      <button role="menuitem" disabled={disabled} onClick={onSelect}>
        {children}
      </button>
    ),
  };
});

import { ProjectHeader } from "./ProjectHeader";

const REACT_ACT_ENVIRONMENT = globalThis as {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
REACT_ACT_ENVIRONMENT.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("ProjectHeader project options", () => {
  it("A2-PROJECT-MENU-CONTROLS invokes each project control", async () => {
    const exportYaml = vi.fn();
    const collection = vi.fn();
    const archive = vi.fn(async () => {});
    const newProject = vi.fn(async () => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <MemoryRouter>
          <AgentNativeI18nProvider
            catalog={i18nCatalog}
            persistPreference={false}
          >
            <ProjectHeader
              title="QA project"
              canRename={true}
              onRename={async () => {}}
              onExportYaml={exportYaml}
              onAddToCollection={collection}
              onArchive={archive}
              onNewProject={newProject}
            />
          </AgentNativeI18nProvider>
        </MemoryRouter>,
      ),
    );
    const click = async (label: string) => {
      const item = [
        ...container!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      ].find((node) => node.textContent?.trim() === label);
      expect(item, `${label}: ${container!.textContent}`).toBeDefined();
      await act(async () => item?.click());
    };
    await click("Export as");
    await click("Analytics project (.yaml)");
    await click("Add to collection");
    await click("Archive");
    await click("New project");
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
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () =>
        root?.render(
          <MemoryRouter>
            <AgentNativeI18nProvider
              catalog={i18nCatalog}
              persistPreference={false}
            >
              <ProjectHeader
                title="QA project"
                canRename={true}
                onRename={async () => {}}
                onArchive={fail}
                onNewProject={fail}
              />
            </AgentNativeI18nProvider>
          </MemoryRouter>,
        ),
      );
      const item = [
        ...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      ].find((node) => node.textContent?.trim() === label);
      expect(item).toBeDefined();
      await act(async () => item?.click());
      expect(container.textContent).toContain("Menu callback failed");
    },
  );

  it("shows an asynchronous project creation failure", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <MemoryRouter>
          <AgentNativeI18nProvider
            catalog={i18nCatalog}
            persistPreference={false}
          >
            <ProjectHeader
              title="QA project"
              canRename={true}
              onRename={async () => {}}
              onNewProject={async () => {
                throw new Error("Creation unavailable");
              }}
            />
          </AgentNativeI18nProvider>
        </MemoryRouter>,
      ),
    );
    const item = [
      ...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].find((node) => node.textContent?.trim() === "New project");
    expect(item).toBeDefined();
    await act(async () => item?.click());
    expect(container.textContent).toContain("Creation unavailable");
  });

  it("opens the export choices on hover", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <MemoryRouter>
          <AgentNativeI18nProvider
            catalog={i18nCatalog}
            persistPreference={false}
          >
            <ProjectHeader
              title="QA project"
              canRename={true}
              onRename={async () => {}}
              onExportYaml={() => {}}
              onExportIpynb={() => {}}
            />
          </AgentNativeI18nProvider>
        </MemoryRouter>,
      ),
    );
    const item = [
      ...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].find((node) => node.textContent?.trim() === "Export as");
    expect(item).toBeDefined();
    await act(async () =>
      item?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
    );
    expect(container.textContent).toContain("Analytics project (.yaml)");
    expect(container.textContent).toContain("Jupyter notebook (.ipynb)");
  });
});
