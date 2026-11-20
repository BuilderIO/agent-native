// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({ data: { workspaces: [] } }),
  useActionMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
}));
vi.mock("react-router", () => ({
  Link: ({ to, children }: { to: string; children?: unknown }) => (
    <a href={to}>{children as never}</a>
  ),
}));
vi.mock("@/components/form-menu/FormMenu", () => ({ FormMenu: () => null }));
vi.mock("@/components/home/FolderMenu", () => ({ FolderMenu: () => null }));
vi.mock("@/components/ui/sonner", () => ({
  sonnerToast: { success: vi.fn(), error: vi.fn() },
}));

import { FolderRow } from "./FolderRow";
import { FormRow } from "./FormRow";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function render(node: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => createRoot(host).render(node));
  return host;
}

// happy-dom's DragEvent is thin, so the payload is supplied explicitly.
function dragEvent(type: string, formId?: string) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const data = new Map<string, string>();
  if (formId) data.set("text/plain", formId);
  Object.defineProperty(event, "dataTransfer", {
    value: {
      effectAllowed: "all",
      dropEffect: "none",
      setData: (k: string, v: string) => data.set(k, v),
      getData: (k: string) => data.get(k) ?? "",
    },
  });
  return event;
}

describe("moving a form onto a folder", () => {
  it("picks a form row up and reports which form it is", () => {
    const onDragStartForm = vi.fn();
    const host = render(
      <FormRow
        form={
          {
            id: "form-1",
            name: "QA form",
            status: "draft",
            submissionCount: 0,
            updatedAt: new Date().toISOString(),
            workspaceId: "ws-1",
            folderId: null,
          } as never
        }
        onDragStartForm={onDragStartForm}
      />,
    );
    const row = host.querySelector("[data-form-row='form-1']");
    expect(row?.getAttribute("draggable")).toBe("true");
    act(() => {
      row?.dispatchEvent(dragEvent("dragstart", "form-1"));
    });
    expect(onDragStartForm).toHaveBeenCalledWith("form-1");
  });

  it("hands the dragged form to the folder it is dropped on", () => {
    const onDropForm = vi.fn();
    const host = render(
      <FolderRow
        workspaceId="ws-1"
        folder={{ id: "f-1", name: "Campaigns", position: 0, formCount: 0 }}
        onDropForm={onDropForm}
      />,
    );
    const target = host.querySelector("[data-folder-drop='f-1']");
    act(() => {
      target?.dispatchEvent(dragEvent("dragover", "form-1"));
      target?.dispatchEvent(dragEvent("drop", "form-1"));
    });
    expect(onDropForm).toHaveBeenCalledWith("form-1");
  });

  it("does not hijack drops when the list cannot move forms", () => {
    const host = render(
      <FolderRow
        workspaceId="ws-1"
        folder={{ id: "f-2", name: "Archive", position: 0, formCount: 0 }}
      />,
    );
    const target = host.querySelector("[data-folder-drop='f-2']");
    const event = dragEvent("drop", "form-1");
    act(() => {
      target?.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
  });
});
