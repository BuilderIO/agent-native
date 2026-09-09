// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { pageTrashMessages } from "../../page-trash-messages";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  PageTrashDialog,
  PageTrashMenuItem,
  PageTrashSelectionButton,
  usePageTrashControl,
} from "./PageTrashControl";

const trash = vi.hoisted(() => vi.fn());
const restore = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true }));
const notice = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock("@/hooks/use-trash-pages", () => ({
  useTrashPages: () => ({ mutateAsync: trash, isPending: false }),
}));
vi.mock("@/hooks/use-documents", () => ({
  useRestoreDocument: () => ({ mutateAsync: restore }),
}));
vi.mock("sonner", () => ({ toast: notice }));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, args?: { count: number }) => {
    const value =
      pageTrashMessages["en-US"][
        key.replace(
          "pageTrash.",
          "",
        ) as keyof (typeof pageTrashMessages)["en-US"]
      ];
    return value.replace("{{count}}", String(args?.count ?? ""));
  },
}));

let root: Root;
let host: HTMLDivElement;
function Harness() {
  const control = usePageTrashControl({
    pages: [
      { id: "page-a", title: "Alpha" },
      { id: "page-b", title: "Beta" },
    ],
  });
  return (
    <>
      <PageTrashSelectionButton control={control} />
      <PageTrashDialog control={control} />
    </>
  );
}
async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
  await act(async () =>
    (host.querySelector("button") as HTMLButtonElement).click(),
  );
}
async function confirm() {
  const button = Array.from(
    document.querySelectorAll('[role="dialog"] button'),
  ).find((button) => /^Move pages? to Trash$/.test(button.textContent ?? ""));
  expect(button).toBeDefined();
  await act(async () => (button as HTMLButtonElement).click());
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.clearAllMocks();
});

describe("page trash confirmation", () => {
  it("counts affected child pages while Undo restores only the root", async () => {
    trash.mockResolvedValueOnce({
      results: [
        {
          id: "page-a",
          status: "trashed",
          affectedDocumentIds: ["page-a", "page-b"],
          affectedDatabaseIds: [],
        },
        {
          id: "page-b",
          status: "covered",
          affectedDocumentIds: [],
          affectedDatabaseIds: [],
        },
      ],
      affectedDocumentIds: ["page-a", "page-b"],
      affectedDatabaseIds: [],
    });
    await mount();
    await confirm();
    expect(notice.mock.calls[0][0]).toBe("Pages moved to Trash: 2");
    await act(async () => notice.mock.calls[0][1].action.onClick());
    expect(restore).toHaveBeenCalledExactlyOnceWith({ id: "page-a" });
  });

  it("keeps the confirmation mounted when its row menu closes", async () => {
    function RowMenu() {
      const control = usePageTrashControl({
        pages: [{ id: "canonical-page", title: "" }],
      });
      return (
        <>
          <DropdownMenu defaultOpen>
            <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuGroup>
                <PageTrashMenuItem control={control} />
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <PageTrashDialog control={control} />
        </>
      );
    }
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<RowMenu />));
    const trigger = host.querySelector("button");
    const item = document.querySelector('[role="menuitem"]');
    expect(item?.textContent).toContain("Move page to Trash");
    await act(async () => (item as HTMLElement).click());
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.querySelector('[role="dialog"] ul')?.textContent).toBe(
      "Untitled",
    );
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Move page to Trash?",
    );
    expect(
      document.querySelector('[role="dialog"]')?.textContent,
    ).not.toContain("canonical-page");
    const cancel = Array.from(
      document.querySelectorAll('[role="dialog"] button'),
    ).find((button) => button.textContent === "Cancel");
    await act(async () => (cancel as HTMLButtonElement).click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps failures visible, retries only failed pages, and undoes only committed roots", async () => {
    trash.mockResolvedValueOnce({
      results: [
        {
          id: "page-a",
          status: "trashed",
          affectedDocumentIds: ["page-a"],
          affectedDatabaseIds: [],
        },
        {
          id: "page-b",
          status: "failed",
          affectedDocumentIds: [],
          affectedDatabaseIds: [],
          error: { code: "forbidden", message: "Access changed" },
        },
      ],
      affectedDocumentIds: ["page-a"],
      affectedDatabaseIds: [],
    });
    await mount();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "trashed everywhere",
    );
    await confirm();
    expect(trash).toHaveBeenCalledWith({ ids: ["page-a", "page-b"] });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Beta: Access changed",
    );
    expect(document.querySelector('[role="dialog"] ul')?.textContent).toBe(
      "Beta",
    );
    const undo = notice.mock.calls[0][1].action.onClick;
    await act(async () => undo());
    expect(restore).toHaveBeenCalledExactlyOnceWith({ id: "page-a" });
    trash.mockResolvedValueOnce({
      results: [
        {
          id: "page-b",
          status: "trashed",
          affectedDocumentIds: ["page-b"],
          affectedDatabaseIds: [],
        },
      ],
      affectedDocumentIds: ["page-b"],
      affectedDatabaseIds: [],
    });
    await confirm();
    expect(trash).toHaveBeenLastCalledWith({ ids: ["page-b"] });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("does not dismiss an unreadable mutation response or offer Undo", async () => {
    trash.mockRejectedValueOnce(new Error("Network unavailable"));
    await mount();
    await confirm();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not trash pages.",
    );
    expect(document.querySelector('[role="dialog"] ul')?.textContent).toBe(
      "AlphaBeta",
    );
    expect(notice).not.toHaveBeenCalled();
  });
});
