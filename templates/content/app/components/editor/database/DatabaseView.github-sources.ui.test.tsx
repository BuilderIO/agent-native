// @vitest-environment happy-dom
import type { ContentDatabaseSource } from "@shared/api";
import { describe, expect, it, vi } from "vitest";

import { click, renderUi } from "@/test-utils/render-ui";

import { SourcesListView } from "./DatabaseView";

const github = {
  id: "source-1",
  databaseId: "database-1",
  sourceType: "github",
  sourceName: "acme/handbook/docs",
  metadata: {
    github: {
      owner: "acme",
      repo: "handbook",
      branch: "main",
      path: "docs",
      folderUrl: "https://github.com/acme/handbook/tree/main/docs",
    },
  },
} as unknown as ContentDatabaseSource;

function sourcesList(
  props: Partial<Parameters<typeof SourcesListView>[0]> = {},
) {
  renderUi(
    <SourcesListView
      source={github}
      sources={[github]}
      builderConfigured={false}
      builderSpaceLabel={null}
      onOpenBuilder={vi.fn()}
      onOpenNotion={vi.fn()}
      onOpenLocalFolder={vi.fn()}
      showLocalFolder={false}
      onOpenSecondary={vi.fn()}
      onAddSource={vi.fn()}
      {...props}
    />,
  );
}

function disconnectButton() {
  return Array.from(document.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Disconnect source"),
  );
}

describe("Sources settings for a GitHub folder", () => {
  it("lets an editor disconnect the folder", async () => {
    const onDisconnectGitHub = vi.fn();
    sourcesList({ onDisconnectGitHub });
    expect(document.body.textContent).toContain("Stop following the folder");

    await click(disconnectButton()!);
    expect(onDisconnectGitHub).toHaveBeenCalledWith(github);
  });

  it("waits while a disconnect runs", () => {
    sourcesList({ onDisconnectGitHub: vi.fn(), disconnectPending: true });
    expect(disconnectButton()?.disabled).toBe(true);
  });

  it("offers no disconnect to readers who can't edit", () => {
    sourcesList();
    expect(disconnectButton()).toBeUndefined();
  });
});
