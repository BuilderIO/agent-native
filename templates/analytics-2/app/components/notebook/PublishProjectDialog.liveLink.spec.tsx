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
  project: { cells: [], appLayout: null },
  outputs: [],
  run: null,
  diff: [],
  compared: {
    description: "First release",
    publishedAt: "2026-11-18T00:00:00Z",
    project: {},
  },
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

it("links the Publish app dialog to the live published app it replaces", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
              projectId="project a"
              canForce={false}
              onClose={() => {}}
              onPublished={() => {}}
              onPublishingChange={() => {}}
              prepare={async () => ({
                expectedHead: draftHeadSchema.parse({
                  versionId: "v",
                  revision: "1",
                }),
                expectedReleaseId: "r",
              })}
            />
          </MemoryRouter>
        </AgentNativeI18nProvider>,
      );
    });
    const link = Array.from(document.querySelectorAll("a")).find((a) =>
      /^Go to live/.test(a.textContent ?? ""),
    );
    expect(link?.getAttribute("href")).toBe("/app/project%20a/latest");
    expect(link?.getAttribute("target")).toBe("_blank");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
