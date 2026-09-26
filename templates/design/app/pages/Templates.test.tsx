// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesignTemplateLibrary } from "@/components/templates/DesignTemplateLibrary";

import Templates from "./Templates";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  refetch: vi.fn(),
  toastError: vi.fn(),
  queryClient: { invalidateQueries: vi.fn() },
  detailLoading: false,
  detailError: false,
  details: {
    files: [
      {
        templateFileId: "first",
        filename: "first.html",
        fileType: "html",
        content: "<button>First screen</button>",
        width: 1280,
        height: 720,
      },
      {
        templateFileId: "second",
        filename: "second.html",
        fileType: "html",
        content: "<button>Second screen</button>",
        width: 1080,
        height: 1080,
      },
    ],
  },
  templates: [
    {
      id: "saved",
      title: "Saved template",
      description: "Owned reusable content",
      isBuiltIn: false,
      isOwner: true,
      category: "social",
      width: 1080,
      height: 1080,
      lockedLayerCount: 2,
      previewHtml: "<h1>Saved</h1>",
    },
    {
      id: "starter",
      title: "Starter template",
      description: "Starter content",
      isBuiltIn: true,
      isOwner: false,
      category: "social",
      width: 1080,
      height: 1080,
      lockedLayerCount: 2,
      previewHtml: "<h1>Starter</h1>",
    },
  ],
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : undefined,
  useActionQuery: (name: string) =>
    name === "get-design-template"
      ? {
          data: mocks.details,
          isLoading: mocks.detailLoading,
          isError: mocks.detailError,
          refetch: mocks.refetch,
        }
      : {
          data: { templates: mocks.templates },
          isLoading: false,
          isError: false,
        },
  useActionMutation: (name: string) => ({
    mutateAsync:
      name === "create-design-from-template" ? mocks.create : mocks.remove,
  }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, params?: { title?: string }) =>
    params?.title ? key + ":" + params.title : key,
}));
vi.mock("@agent-native/core/client/sharing", () => ({
  ShareButton: ({
    resourceId,
    allowedRoles,
  }: {
    resourceId: string;
    allowedRoles: string[];
  }) => (
    <button
      data-share-id={resourceId}
      data-allowed-roles={allowedRoles.join(",")}
    >
      Share fixture
    </button>
  ),
}));
vi.mock("@agent-native/toolkit/app-shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/toolkit/app-shell")>()),
  useSetPageTitle: () => {},
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mocks.queryClient,
}));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => mocks.navigate,
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));
vi.mock("@/components/templates/TemplatePreview", () => ({
  TemplatePreview: ({
    title,
    html,
    interactive,
    onNavigate,
    onEscape,
  }: {
    title: string;
    html: string;
    interactive?: boolean;
    onNavigate?: (href: string) => void;
    onEscape?: () => void;
  }) => (
    <div
      data-preview-title={title}
      data-interactive={interactive || undefined}
      data-html={html}
    >
      {interactive ? (
        <>
          <button
            onClick={() => onNavigate?.("./second.html?from=preview#hero")}
          >
            Local next fixture
          </button>
          <button
            onClick={() => onNavigate?.("/_agent-native/actions/delete-design")}
          >
            Blocked link fixture
          </button>
          <button onClick={() => onNavigate?.("/50%off.html")}>
            Malformed link fixture
          </button>
          <button onClick={onEscape}>Escape fixture</button>
        </>
      ) : null}
    </div>
  ),
}));

let container: HTMLDivElement;
let root: Root;
function LocationProbe() {
  const location = useLocation();
  return <output data-location>{location.search}</output>;
}
async function render(
  children: ReactNode = <Templates />,
  initial = "/templates",
) {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[initial]}>
        {children}
        <LocationProbe />
      </MemoryRouter>,
    ),
  );
}
function named(role: string, name?: string) {
  const selector =
    role === "button" ? 'button,[role="button"]' : '[role="' + role + '"]';
  return [...document.querySelectorAll<HTMLElement>(selector)].filter(
    (element) => {
      const labelIds = element.getAttribute("aria-labelledby");
      const label =
        element.getAttribute("aria-label") ??
        (labelIds
          ? labelIds
              .split(" ")
              .map((id) => document.getElementById(id)?.textContent)
              .join(" ")
          : element.textContent);
      return name === undefined || label?.trim() === name;
    },
  );
}
function get(role: string, name?: string) {
  const element = named(role, name)[0];
  expect(element, role + " " + (name ?? "")).toBeTruthy();
  return element!;
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
async function openMenu(index = 0) {
  const trigger = get(
    "button",
    "templatesPage.templateActions:" + mocks.templates[index].title,
  );
  await act(async () =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
}
async function preview(index = 0) {
  await openMenu(index);
  const previewAction = get("menuitem", "creativeContext.preview");
  expect(previewAction.querySelector("svg")).toBeNull();
  await click(previewAction);
  return get("dialog");
}
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.detailLoading = false;
  mocks.detailError = false;
  mocks.create.mockResolvedValue({ id: "new-copy", adaptationPending: false });
  mocks.queryClient.invalidateQueries.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Design template library", () => {
  it("copies directly with template identity only, preserving server-owned locks and brand", async () => {
    await render();
    await click(get("button", "Starter template"));
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      templateId: "starter",
      title: "Starter template",
      newId: expect.any(String),
    });
    expect(mocks.navigate).toHaveBeenCalledWith("/design/new-copy");
    expect(named("dialog")).toHaveLength(0);
  });
  it("shows only title, description, title-specific menus and matching route layout", async () => {
    await render();
    expect(document.body.textContent).toContain("Owned reusable content");
    for (const absent of [
      "templatesPage.builtIn",
      "templatesPage.useTemplate",
      "templatesPage.lockedCount",
      "1080",
      "social",
    ])
      expect(document.body.textContent).not.toContain(absent);
    expect(
      named("button", "templatesPage.templateActions:Saved template"),
    ).toHaveLength(1);
    expect(
      named("button", "templatesPage.templateActions:Starter template"),
    ).toHaveLength(1);
    expect(container.querySelector("main")).toBeNull();
    expect(container.firstElementChild?.className).toBe(
      "mx-auto grid w-full max-w-370 gap-6 px-4 py-6 sm:px-6 lg:px-8",
    );
  });
  it("guards double activation and every menu while showing copy progress", async () => {
    let resolve!: (value: { id: string }) => void;
    mocks.create.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await render();
    const card = get("button", "Starter template");
    await click(card);
    await click(card);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(get("status").textContent).toContain("templatesPage.opening");
    for (const template of mocks.templates)
      expect(
        (
          get(
            "button",
            "templatesPage.templateActions:" + template.title,
          ) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    await openMenu();
    expect(named("menu")).toHaveLength(0);
    await act(async () => resolve({ id: "new-copy" }));
  });
  it("reports a missing copy ID with localized copy and no automatic retry", async () => {
    mocks.create.mockResolvedValue({});
    await render();
    await click(get("button", "Starter template"));
    expect(mocks.toastError).toHaveBeenCalledWith("templatesPage.createFailed");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("reports an action failure without automatically retrying or navigating", async () => {
    mocks.create.mockRejectedValue({ code: "network_error" });
    await render();
    await click(get("button", "Starter template"));
    expect(mocks.toastError).toHaveBeenCalledWith("templatesPage.createFailed");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("runs full HTML as a live preview and switches known screens without copying", async () => {
    await render();
    const dialog = await preview();
    expect(
      dialog
        .querySelector('[data-interactive="true"]')
        ?.getAttribute("data-html"),
    ).toBe("<button>First screen</button>");
    await click(get("button", "second.html"));
    expect(
      dialog
        .querySelector('[data-interactive="true"]')
        ?.getAttribute("data-html"),
    ).toBe("<button>Second screen</button>");
    await click(get("button", "first.html"));
    await click(get("button", "Blocked link fixture"));
    expect(
      dialog
        .querySelector('[data-interactive="true"]')
        ?.getAttribute("data-preview-title"),
    ).toBe("first.html");
    await click(get("button", "Malformed link fixture"));
    expect(
      dialog
        .querySelector('[data-interactive="true"]')
        ?.getAttribute("data-preview-title"),
    ).toBe("first.html");
    await click(get("button", "Local next fixture"));
    expect(
      dialog
        .querySelector('[data-interactive="true"]')
        ?.getAttribute("data-preview-title"),
    ).toBe("second.html");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("uses the template from the preview header action", async () => {
    await render();
    await preview(1);
    await click(get("button", "templatesPage.useTemplate"));
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      templateId: "starter",
      title: "Starter template",
      newId: expect.any(String),
    });
    expect(mocks.navigate).toHaveBeenCalledWith("/design/new-copy");
  });
  it("restores focus and clears only preview URL state via Escape", async () => {
    await render(<Templates />, "/templates?search=template&keep=fixture");
    const trigger = get(
      "button",
      "templatesPage.templateActions:Saved template",
    );
    await preview();
    expect(container.querySelector("[data-location]")?.textContent).toBe(
      "?search=template&keep=fixture&templateId=saved",
    );
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(named("dialog")).toHaveLength(0);
    expect(container.querySelector("[data-location]")?.textContent).toBe(
      "?search=template&keep=fixture",
    );
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("retains saved-owner sharing roles and delete only in the menu", async () => {
    await render();
    expect(named("button", "Share fixture")).toHaveLength(0);
    await openMenu();
    expect(
      get("button", "Share fixture").getAttribute("data-allowed-roles"),
    ).toBe("viewer,editor,admin");
    await click(get("menuitem", "home.delete"));
    expect(get("alertdialog")).toBeTruthy();
    await click(get("button", "home.cancel"));
    expect(mocks.remove).not.toHaveBeenCalled();
    await openMenu(1);
    expect(named("button", "Share fixture")).toHaveLength(0);
    expect(named("menuitem", "home.delete")).toHaveLength(0);
  });
  it("owns preview URL state on home without controlled props", async () => {
    await render(
      <DesignTemplateLibrary templates={mocks.templates} />,
      "/home?keep=draft",
    );
    await preview(1);
    expect(container.querySelector("[data-location]")?.textContent).toBe(
      "?keep=draft&templateId=starter",
    );
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(container.querySelector("[data-location]")?.textContent).toBe(
      "?keep=draft",
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("deep-links to a home preview without causing a write", async () => {
    await render(
      <DesignTemplateLibrary templates={mocks.templates} />,
      "/home?templateId=starter",
    );
    expect(get("dialog")).toBeTruthy();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("keeps loading and failure distinct from an empty preview", async () => {
    mocks.detailLoading = true;
    await render();
    await preview();
    expect(get("status", "templatesPage.loading")).toBeTruthy();
    expect(document.querySelector('[data-interactive="true"]')).toBeNull();
    mocks.detailLoading = false;
    mocks.detailError = true;
    await render();
    expect(get("alert").textContent).toContain("common.genericError");
    expect(document.body.textContent).not.toContain(
      "templatesPage.previewEmpty",
    );
    await click(get("button", "homeContext.retry"));
    expect(mocks.refetch).toHaveBeenCalled();
  });
});
