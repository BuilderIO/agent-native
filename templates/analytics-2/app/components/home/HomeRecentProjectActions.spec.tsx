// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

import { HomeRecentsSection } from "./recents";
import type { HomeCallbacks, HomeRecentRow, HomeRecentsTab } from "./types";
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "analytics.lists.moreSelectionActions": "More actions",
      "analytics.lists.actionOpenNewTab": "Open in new tab",
      "analytics.lists.actionCopyLink": "Copy link",
      "analytics.lists.actionAddFavorite": "Add to favorites",
      "analytics.lists.actionRemoveFromFavorites": "Remove from favorites",
      "analytics.home.editDraft": "Edit draft",
      "analytics.home.viewNotebook": "View notebook",
      "analytics.lists.projectLinkCopied": "Project link copied to clipboard",
      "analytics.lists.linkCopyFailed": "Could not copy the link",
      "analytics.lists.actionArchive": "Archive",
      "analytics.lists.actionMoveToTrash": "Move to trash",
    })[key] || key,
}));
const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: feedback }));
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots.length = 0;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function mount(
  callbacks: Partial<HomeCallbacks>,
  href = "/project/qa-owned/latest",
  project: Partial<HomeRecentRow> = {},
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const tab: HomeRecentsTab = {
    kind: "project",
    enabled: true,
    status: "ready",
    rows: [
      {
        id: "qa-owned",
        kind: "project",
        title: "QA owned project",
        href,
        ...project,
      },
    ],
  };
  act(() =>
    root.render(
      <MemoryRouter>
        <HomeRecentsSection
          recents={{
            projects: tab,
            threads: { ...tab, enabled: false },
            explorations: { ...tab, enabled: false },
            data: { ...tab, enabled: false },
          }}
          callbacks={{
            onOpenContextStudio: () => {},
            onBrowseProjects: () => {},
            ...callbacks,
          }}
        />
      </MemoryRouter>,
    ),
  );
  return host;
}
it("exposes the owned project overflow when its authorized caller supplies lifecycle actions", () => {
  const host = mount({ onTrashProject: vi.fn(), onArchiveProject: vi.fn() });
  expect(
    host.querySelector('button[aria-label="More actions"]'),
  ).not.toBeNull();
  expect(
    host.querySelector('a[href="/project/qa-owned/latest"]')?.textContent,
  ).toContain("QA owned project");
});
it("does not expose project mutations when the caller lacks write permission", () => {
  const host = mount({});
  expect(host.querySelector('button[aria-label="More actions"]')).toBeNull();
});

async function openMenu(host: HTMLElement) {
  const trigger = host.querySelector('button[aria-label="More actions"]');
  if (!trigger) throw Error("Missing project overflow");
  await act(async () => {
    trigger.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        button: 0,
        ctrlKey: false,
      }),
    );
  });
}
function item(label: string) {
  const match = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((e) => e.textContent === label);
  if (!match) throw Error("Missing menu item " + label);
  return match;
}
it("keeps trash last, asks for confirmation, and retries the same entity after a failed write", async () => {
  const onTrashProject = vi
    .fn()
    .mockRejectedValueOnce(new Error("Write failed"))
    .mockResolvedValueOnce(undefined);
  const host = mount({ onTrashProject, onArchiveProject: vi.fn() });
  await openMenu(host);
  expect(
    [...document.querySelectorAll('[role="menuitem"]')].map(
      (e) => e.textContent,
    ),
  ).toEqual(["Open in new tab", "Copy link", "Archive", "Move to trash"]);
  await act(async () => item("Move to trash").click());
  expect(onTrashProject).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "QA owned project",
  );
  const confirm = () =>
    [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((e) => e.textContent === "Move to trash");
  await act(async () =>
    (() => {
      const button = confirm();
      if (!button) throw Error("Missing trash confirmation");
      button.click();
    })(),
  );
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Write failed",
  );
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () =>
    (() => {
      const button = confirm();
      if (!button) throw Error("Missing trash confirmation");
      button.click();
    })(),
  );
  expect(onTrashProject.mock.calls).toEqual([["qa-owned"], ["qa-owned"]]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("acknowledges a copied project link only after the clipboard accepts it", async () => {
  let accept: (() => void) | undefined;
  const writeText = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        accept = resolve;
      }),
  );
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const host = mount({ onArchiveProject: vi.fn() });
  await openMenu(host);
  await act(async () => item("Copy link").click());
  expect(writeText).toHaveBeenCalledWith(
    "http://localhost:3000/project/qa-owned/latest",
  );
  expect(feedback.success).not.toHaveBeenCalled();
  await act(async () => accept?.());
  expect(feedback.success).toHaveBeenCalledWith(
    "Project link copied to clipboard",
  );
  expect(feedback.error).not.toHaveBeenCalled();
});
it.each(["refused", "unavailable"])(
  "reports %s clipboard access without success",
  async (mode) => {
    vi.stubGlobal(
      "navigator",
      mode === "unavailable"
        ? {}
        : {
            clipboard: {
              writeText: vi
                .fn()
                .mockRejectedValue(new Error("private permission detail")),
            },
          },
    );
    const host = mount({ onArchiveProject: vi.fn() });
    await openMenu(host);
    await act(async () => item("Copy link").click());
    expect(feedback.success).not.toHaveBeenCalled();
    expect(feedback.error).toHaveBeenCalledWith("Could not copy the link");
  },
);

it("opens published recent projects in App View when choosing Open in new tab", async () => {
  const host = mount({ onArchiveProject: vi.fn() }, "/app/qa-owned/latest");
  await openMenu(host);
  const openLink = document.body.querySelector('a[target="_blank"]');
  expect(openLink?.getAttribute("href")).toBe("/app/qa-owned/latest");
});

it("exposes the recent project star and the published notebook destination", () => {
  const host = mount(
    { onToggleFavoriteProject: vi.fn() },
    "/app/qa-owned/latest",
    {
      favorited: false,
      notebookHref: "/project/qa-owned/latest",
      canEdit: true,
    },
  );
  expect(
    host.querySelector('button[aria-label="Add to favorites"]'),
  ).not.toBeNull();
  expect(host.querySelector('button[aria-label="Edit draft"]')).not.toBeNull();
});

it("labels a readable published notebook without edit access", () => {
  const host = mount({}, "/app/qa-owned/latest", {
    notebookHref: "/project/qa-owned/latest",
    canEdit: false,
  });
  expect(
    host.querySelector('button[aria-label="View notebook"]'),
  ).not.toBeNull();
  expect(host.querySelector('button[aria-label="Edit draft"]')).toBeNull();
});

it("blocks duplicate favorite writes and restores the star after failure so it can retry", async () => {
  let rejectWrite!: (error: Error) => void;
  const pending = new Promise<void>((_resolve, reject) => {
    rejectWrite = reject;
  });
  const onToggleFavoriteProject = vi
    .fn()
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce(undefined);
  const host = mount({ onToggleFavoriteProject }, undefined, {
    favorited: false,
  });
  const button = host.querySelector<HTMLButtonElement>(
    'button[aria-label="Add to favorites"]',
  );
  expect(button).not.toBeNull();
  await act(async () => {
    button!.click();
  });
  expect(button!.disabled).toBe(true);
  expect(button!.getAttribute("aria-pressed")).toBe("true");
  button!.click();
  expect(onToggleFavoriteProject).toHaveBeenCalledTimes(1);
  await act(async () => {
    rejectWrite(new Error("Favorite unavailable"));
  });
  expect(button!.disabled).toBe(false);
  expect(button!.getAttribute("aria-pressed")).toBe("false");
  expect(feedback.error).toHaveBeenCalledTimes(1);
  await act(async () => {
    button!.click();
  });
  expect(onToggleFavoriteProject).toHaveBeenNthCalledWith(2, "qa-owned", true);
});
