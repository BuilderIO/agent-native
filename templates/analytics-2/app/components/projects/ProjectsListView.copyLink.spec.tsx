// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";
import type { Project } from "@/lib/model/contracts";

import { ProjectsListView } from "./ProjectsListView";

const project: Project = {
  id: "prj_duplicate",
  ownerEmail: "qa@workspace.test",
  title: "Revenue",
  description: "",
  language: "python",
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-05T00:00:00.000Z",
};

function render(row: Project & { lastPublishedAt?: string | null } = project) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
        <ProjectsListView
          status="ready"
          projects={[row]}
          currentUser={{ name: "QA", email: "qa@workspace.test" }}
          search=""
          onSearchChange={() => {}}
          onCreateProject={() => {}}
          fixture="fixture"
          now={Date.parse("2026-11-05T12:00:00.000Z")}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  return { container, root };
}

function menuItem(label: string) {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent?.trim() === label,
  );
}

const mountPath = vi.hoisted(() => ({ value: "" }));
vi.mock("@agent-native/core/client/api-path", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, appBasePath: () => mountPath.value };
});

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: feedback }));

const callActionMock = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, callAction: callActionMock };
});

it.each([
  {
    state: "published",
    lastPublishedAt: "2026-11-05T00:00:00.000Z",
    route: "app",
  },
  { state: "draft", lastPublishedAt: null, route: "project" },
])(
  "opens the $state project row and menu at the same destination",
  async ({ lastPublishedAt, route }) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mountPath.value = "/analytics-2";
    const { container, root } = render({ ...project, lastPublishedAt });
    try {
      const destination = `/analytics-2/${route}/prj_duplicate/latest`;
      expect(
        container
          .querySelector('a[data-rid="projects.list.open"]')
          ?.getAttribute("href"),
      ).toBe(destination);
      const trigger = container.querySelector<HTMLButtonElement>(
        'button[aria-label="View more actions"]',
      );
      if (!trigger) throw Error("Row actions trigger missing");
      await act(async () => {
        trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      });
      expect(
        menuItem("Export Jupyter notebook (.ipynb)")?.getAttribute("href"),
      ).toBe("/analytics-2/project/prj_duplicate/latest?export=ipynb");
      expect(menuItem("Open in new tab")?.getAttribute("href")).toBe(
        destination,
      );
    } finally {
      act(() => root.unmount());
      container.remove();
      mountPath.value = "";
      vi.unstubAllGlobals();
    }
  },
);

it.each(["accepted", "refused", "unavailable"])(
  "copies from a project row with truthful %s feedback",
  async (mode) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const writeText = vi.fn().mockImplementation(async () => {
      if (mode === "refused") throw new Error("private clipboard detail");
    });
    vi.stubGlobal(
      "navigator",
      mode === "unavailable"
        ? { userAgent: "test" }
        : { userAgent: "test", clipboard: { writeText } },
    );
    const { container, root } = render();
    try {
      const trigger = container.querySelector<HTMLButtonElement>(
        'button[aria-label="View more actions"]',
      );
      if (!trigger) throw Error("Row actions trigger missing");
      await act(async () => {
        trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      });
      const copy = menuItem("Copy link");
      if (!copy) throw Error("Copy link menu item missing");
      await act(async () => copy.click());
      expect(menuItem("Copy link")).toBeUndefined();
      if (mode === "accepted") {
        expect(writeText).toHaveBeenCalledWith(
          "http://localhost:3000/project/prj_duplicate/latest",
        );
        expect(feedback.success).toHaveBeenCalledWith(
          "Project link copied to clipboard",
        );
        expect(feedback.error).not.toHaveBeenCalled();
      } else {
        expect(feedback.success).not.toHaveBeenCalled();
        expect(feedback.error).toHaveBeenCalledWith("Could not copy the link");
      }
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  },
);

it("exports a Python project row as .ipynb instead of downloading the HTML route", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  callActionMock.mockResolvedValue({
    id: "prj_duplicate",
    title: "Revenue",
    language: "python",
    cells: [
      {
        id: "cell-1",
        contents: { kind: "code", source: "print(1)", language: "python" },
      },
    ],
  });
  const createObjectURL = vi.fn(() => "blob:ipynb-test");
  const revokeObjectURL = vi.fn();
  const origCreateObjectURL = URL.createObjectURL;
  const origRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  const clicked: Array<{ href: string; download: string }> = [];
  const origCreateElement = document.createElement.bind(document);
  let createElementSpy: ReturnType<typeof vi.spyOn> | undefined;
  const { container, root } = render();
  try {
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="View more actions"]',
    );
    if (!trigger) throw Error("Row actions trigger missing");
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    const exportItem = menuItem("Export Jupyter notebook (.ipynb)");
    if (!exportItem) throw Error("Export Jupyter notebook menu item missing");
    expect(exportItem.hasAttribute("download")).toBe(false);
    createElementSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation(((
        tagName: string,
        options?: ElementCreationOptions,
      ) => {
        const el = origCreateElement(tagName, options);
        if (tagName.toLowerCase() === "a") {
          vi.spyOn(el as HTMLAnchorElement, "click").mockImplementation(() => {
            clicked.push({
              href: (el as HTMLAnchorElement).href,
              download: (el as HTMLAnchorElement).download,
            });
          });
        }
        return el;
      }) as typeof document.createElement);
    await act(async () => {
      exportItem.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(callActionMock).toHaveBeenCalledWith("get-project", {
      projectId: "prj_duplicate",
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clicked).toEqual([
      { href: "blob:ipynb-test", download: "revenue.ipynb" },
    ]);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:ipynb-test");
  } finally {
    createElementSpy?.mockRestore();
    URL.createObjectURL = origCreateObjectURL;
    URL.revokeObjectURL = origRevokeObjectURL;
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  }
});
