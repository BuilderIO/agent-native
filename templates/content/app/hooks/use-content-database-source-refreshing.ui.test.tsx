// @vitest-environment happy-dom
import { useMutation } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { click, renderUi } from "@/test-utils/render-ui";

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useActionMutation: (_name: string, options: object) =>
    useMutation({ ...options, mutationFn: () => new Promise(() => {}) }),
}));

import { SourceUnlinkDialog } from "@/components/editor/database/SourceUnlinkDialog";

import {
  useContentDatabaseSourceRefreshing,
  useRefreshContentDatabaseSource,
} from "./use-content-database";
import { useSyncGitHubFolder } from "./use-github-folder";

function Probe() {
  const refresh = useRefreshContentDatabaseSource("collection-1");
  const thisOne = useContentDatabaseSourceRefreshing("source-1");
  const another = useContentDatabaseSourceRefreshing("source-2");
  return (
    <button
      type="button"
      data-this-one={String(thisOne)}
      data-another={String(another)}
      onClick={() =>
        refresh.mutate({ documentId: "collection-1", sourceId: "source-1" })
      }
    >
      Sync now
    </button>
  );
}

function GitHubProbe() {
  const syncNow = useSyncGitHubFolder({ refreshingSourceId: "source-1" });
  const fill = useSyncGitHubFolder({ refresh: false });
  const refreshing = useContentDatabaseSourceRefreshing("source-1");
  return (
    <div data-refreshing={String(refreshing)}>
      <button
        type="button"
        onClick={() => fill.mutate({ databaseId: "database-1" })}
      >
        Fill
      </button>
      <button
        type="button"
        onClick={() => syncNow.mutate({ databaseId: "database-1" })}
      >
        Sync now
      </button>
    </div>
  );
}

function UnlinkWhileRefreshProbe() {
  const refresh = useRefreshContentDatabaseSource("collection-1");
  return (
    <>
      <button
        type="button"
        onClick={() =>
          refresh.mutate({ documentId: "collection-1", sourceId: "source-1" })
        }
      >
        Continue
      </button>
      <SourceUnlinkDialog
        open
        onOpenChange={() => {}}
        provider="builder"
        documentId="collection-1"
        sourceId="source-1"
        pageCount={2}
      />
    </>
  );
}

function buttonNamed(name: string, root: ParentNode = document) {
  const found = [...root.querySelectorAll("button")].find(
    (button) => button.textContent.trim() === name,
  );
  if (!found) throw new Error(`No ${name} button`);
  return found;
}

describe("useContentDatabaseSourceRefreshing", () => {
  it("sees a refresh another control started, for that source only", async () => {
    const { container } = renderUi(<Probe />);
    const probe = container.querySelector("button");
    if (!probe) throw new Error("No probe");
    expect(probe.dataset.thisOne).toBe("false");

    await click(probe);
    expect(probe.dataset.thisOne).toBe("true");
    expect(probe.dataset.another).toBe("false");
  });

  it("sees GitHub's Sync now, but not a step of a fill", async () => {
    const { container } = renderUi(
      <MemoryRouter>
        <GitHubProbe />
      </MemoryRouter>,
    );
    const probe = container.querySelector<HTMLElement>("[data-refreshing]");
    if (!probe) throw new Error("No probe");

    await click(buttonNamed("Fill", container));
    expect(probe.dataset.refreshing).toBe("false");

    await click(buttonNamed("Sync now", container));
    expect(probe.dataset.refreshing).toBe("true");
  });

  it("stops an open Unlink dialog confirming once a refresh starts", async () => {
    renderUi(
      <MemoryRouter>
        <UnlinkWhileRefreshProbe />
      </MemoryRouter>,
    );
    const dialog = document.querySelector('[role="alertdialog"]');
    if (!dialog) throw new Error("No dialog");
    expect(buttonNamed("Unlink", dialog).disabled).toBe(false);

    await click(buttonNamed("Continue"));
    expect(buttonNamed("Unlink", dialog).disabled).toBe(true);
  });
});
