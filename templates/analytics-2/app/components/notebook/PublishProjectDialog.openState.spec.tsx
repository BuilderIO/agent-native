// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";

import { draftHeadSchema } from "../../../shared/notebook-snapshot-contract";

const preview = vi.hoisted(() => ({
  previewId: "preview-1",
  state: "ready",
  project: {
    cells: [],
    appLayout: {
      settings: { scratchOnLoad: false, autoRefresh: true, autoRerun: false },
    },
  },
  outputs: [],
  run: null,
  diff: [],
  compared: null,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorCode: vi.fn(),
  useActionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useActionQuery: () => ({ data: preview, error: null, refetch: vi.fn() }),
}));
vi.mock("@/components/published/usePublishedResultPages", () => ({
  usePublishedResultPages: () => ({ outputs: {}, loadPage: vi.fn() }),
}));
vi.mock("@/components/published/AppLayoutSnapshot", () => ({
  AppLayoutSnapshot: () => null,
}));
vi.mock("./PublishNotebookDiff", () => ({ PublishNotebookDiff: () => null }));
vi.mock("./NotebookRunControls", () => ({
  useLastRunLabel: () => "1 day ago",
}));

import { PublishProjectDialog } from "./PublishProjectDialog";

async function withDialog(check: () => void | Promise<void>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/project/p?keep=1");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          persistPreference={false}
        >
          <MemoryRouter>
            <PublishProjectDialog
              projectId="p"
              canForce={false}
              onClose={() => {}}
              onPublished={() => {}}
              onPublishingChange={() => {}}
              prepare={async () => ({
                expectedHead: draftHeadSchema.parse({
                  versionId: "v",
                  revision: "1",
                }),
                expectedReleaseId: null,
              })}
            />
          </MemoryRouter>
        </AgentNativeI18nProvider>,
      );
    });
    await check();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
}

it("focuses the version details field when the dialog opens", async () => {
  await withDialog(() => {
    const field = document.querySelector("textarea");
    expect(field).not.toBeNull();
    expect(document.activeElement).toBe(field);
  });
});

it("shows the dialog in the URL while open and removes it on close", async () => {
  await withDialog(() => {
    expect(new URL(window.location.href).searchParams.get("dialog")).toBe(
      "publish",
    );
    expect(new URL(window.location.href).searchParams.get("keep")).toBe("1");
  });
  expect(new URL(window.location.href).searchParams.has("dialog")).toBe(false);
  expect(new URL(window.location.href).searchParams.get("keep")).toBe("1");
});

it("offers Request review as a visible button and keeps run settings expanded", async () => {
  await withDialog(() => {
    const button = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "Request review",
    );
    expect(button).toBeDefined();
    expect(button?.hasAttribute("disabled")).toBe(false);
    expect(document.querySelector("details")?.open).toBe(true);
  });
});
