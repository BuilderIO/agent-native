// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(),
  useActionQuery: () => ({ data: undefined, isLoading: true, error: null }),
}));
vi.mock("@agent-native/core/client/i18n", async () => {
  const messages = (await import("../../i18n/en-US")).default as Record<
    string,
    unknown
  >;
  const lookup = (key: string): string => {
    let node: unknown = messages;
    for (const part of key.split(".")) {
      node = (node as Record<string, unknown> | undefined)?.[part];
    }
    return typeof node === "string" ? node : key;
  };
  return { useT: () => (key: string) => lookup(key) };
});

import { AddProjectsDialog } from "@/components/collections/AddProjectsDialog";
import { NewCollectionDialog } from "@/components/collections/NewCollectionDialog";
import { ProjectCategoriesDialog } from "@/components/projects/ProjectCategoriesDialog";
import { ProjectCollectionsPickerDialog } from "@/components/projects/ProjectCollectionsPickerDialog";
import { ProjectStatusDialog } from "@/components/projects/ProjectStatusDialog";
import { TransferProjectOwnerDialog } from "@/components/projects/TransferProjectOwnerDialog";
import type { Project } from "@/lib/model/contracts";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

afterEach(() => {
  document.body.innerHTML = "";
});

const project = { id: "prj_1", title: "Revenue", statusId: null } as Project;

const dialogs: [string, (onClose: () => void) => ReactElement][] = [
  [
    "new collection",
    (onClose) => <NewCollectionDialog onClose={onClose} />,
  ],
  [
    "add projects to a collection",
    (onClose) => (
      <AddProjectsDialog
        collectionId="col_1"
        alreadyFiled={[]}
        onClose={onClose}
      />
    ),
  ],
  [
    "project status",
    (onClose) => <ProjectStatusDialog project={project} onClose={onClose} />,
  ],
  [
    "project categories",
    (onClose) => (
      <ProjectCategoriesDialog project={project} onClose={onClose} />
    ),
  ],
  [
    "collection picker",
    (onClose) => (
      <ProjectCollectionsPickerDialog
        projectTitle="Revenue"
        collections={[{ id: "col_1", name: "Finance" }]}
        filedIds={[]}
        onClose={onClose}
        onToggle={async () => {}}
      />
    ),
  ],
  [
    "owner transfer",
    (onClose) => (
      <TransferProjectOwnerDialog project={project} onClose={onClose} />
    ),
  ],
];

it.each(dialogs)("the %s dialog closes on Escape", (_name, render) => {
  const onClose = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        {render(onClose)}
      </QueryClientProvider>,
    ),
  );
  try {
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
  }
});
