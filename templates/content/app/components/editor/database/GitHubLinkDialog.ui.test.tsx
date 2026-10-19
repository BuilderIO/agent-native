// @vitest-environment happy-dom
import type { GitHubFolderPreview } from "@shared/github-source";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  LinkGitHubFolderRequest,
  LinkGitHubFolderResponse,
} from "@/hooks/use-github-folder";
import { click, renderUi, typeInto } from "@/test-utils/render-ui";

type MutateOptions = {
  onSuccess?: (response: LinkGitHubFolderResponse) => void;
  onError?: (error: unknown) => void;
};

const link = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));
const toasts = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
const oauth = vi.hoisted(() => ({ start: vi.fn() }));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/integrations", () => ({
  startWorkspaceProviderOAuth: oauth.start,
}));
vi.mock("@/hooks/use-github-folder", () => ({
  useLinkGitHubFolder: () => link,
}));
vi.mock("sonner", () => ({ toast: toasts.toast }));

import { GitHubLinkDialog } from "./GitHubLinkDialog";

const FOLDER_URL = "https://github.com/acme/handbook/tree/main/docs";

const preview: GitHubFolderPreview = {
  location: { owner: "acme", repo: "handbook", branch: "main", path: "docs" },
  label: "acme/handbook/docs",
  folderUrl: FOLDER_URL,
  commitSha: "65b1d83c0ffee00000000000000000000000000",
  markdownFiles: 4,
  skipped: [
    { path: "demo.mdx", reason: "mdx" },
    { path: "huge.md", reason: "too-large" },
  ],
  fields: [
    { key: "status", type: "select", examples: ["Draft", "Draft", "Live"] },
    { key: "published", type: "date", examples: ["2026-09-01"] },
  ],
  sample: [
    { path: "faq.md", title: "FAQ" },
    { path: "guides/getting-started.md", title: "Getting started" },
  ],
  sampledFiles: 4,
  images: 1,
  storageReady: false,
};

function dryRun(
  overrides: Partial<Extract<LinkGitHubFolderResponse, { dryRun: true }>> = {},
): LinkGitHubFolderResponse {
  return {
    dryRun: true,
    database: {} as LinkGitHubFolderResponse["database"],
    preview,
    canLink: true,
    blocked: null,
    blockedReason: null,
    summary: "",
    ...overrides,
  };
}

function button(name: string) {
  const match = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!match) throw new Error(`No "${name}" button`);
  return match;
}

function urlInput() {
  const input = document.querySelector<HTMLInputElement>("#github-folder-url");
  if (!input) throw new Error("No folder link input");
  return input;
}

function lastCall() {
  const call = link.mutate.mock.calls[link.mutate.mock.calls.length - 1];
  if (!call) throw new Error("No link-github-folder call");
  return call as [LinkGitHubFolderRequest, MutateOptions];
}

async function previewFolder(response: LinkGitHubFolderResponse = dryRun()) {
  await typeInto(urlInput(), FOLDER_URL);
  await click(button("Preview"));
  const [, options] = lastCall();
  const { act } = await import("react");
  await act(async () => options.onSuccess?.(response));
}

describe("GitHub link dialog", () => {
  const onOpenChange = vi.fn();

  beforeEach(() => {
    link.mutate.mockReset();
    link.isPending = false;
    onOpenChange.mockReset();
    oauth.start.mockReset();
    toasts.toast.success.mockReset();
    toasts.toast.error.mockReset();
  });

  function renderDialog() {
    renderUi(
      <GitHubLinkDialog
        databaseId="database-1"
        open
        onOpenChange={onOpenChange}
      />,
    );
  }

  it("asks for the folder when given a file link, without calling GitHub", async () => {
    renderDialog();
    await typeInto(
      urlInput(),
      "https://github.com/acme/handbook/blob/main/docs/faq.md",
    );
    await click(button("Preview"));
    expect(link.mutate).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "That link is to a file. Paste the link to its folder.",
    );
  });

  it("previews files, typed columns, pages and skipped files before linking", async () => {
    renderDialog();
    expect(button("Link folder").disabled).toBe(true);

    await previewFolder();
    expect(lastCall()[0]).toEqual({
      databaseId: "database-1",
      url: FOLDER_URL,
      dryRun: true,
    });
    const shown = document.querySelector("[data-github-folder-preview]");
    const text = shown?.textContent ?? "";
    expect(text).toContain("acme/handbook/docs at 65b1d83");
    expect(text).toContain("4 Markdown files become pages.");
    expect(text).toContain("statuseditor.propertyTypes.selectDraft, Live");
    expect(text).toContain("publishededitor.propertyTypes.date2026-09-01");
    expect(text).toContain("FAQfaq.md");
    expect(text).toContain("demo.mdxMDX isn’t supported yet");
    expect(text).toContain("huge.mdLarger than 1 MiB");
    expect(text).toContain(
      "Images in this folder show once file storage is set up.",
    );
    expect(button("Link folder").disabled).toBe(false);
  });

  it("links the previewed folder, then closes", async () => {
    renderDialog();
    await previewFolder();

    await click(button("Link folder"));
    expect(lastCall()[0]).toEqual({
      databaseId: "database-1",
      url: FOLDER_URL,
    });
    const { act } = await import("react");
    await act(async () =>
      lastCall()[1].onSuccess?.({
        dryRun: false,
        database: {} as LinkGitHubFolderResponse["database"],
        preview,
        source: null,
        summary: "",
        sync: {
          state: "synced",
          commitSha: preview.commitSha,
          created: 4,
          updated: 0,
          renamed: 0,
          trashed: 0,
          remaining: 0,
          problem: null,
        },
      }),
    );
    expect(toasts.toast.success).toHaveBeenCalledWith(
      "Linked acme/handbook/docs",
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("says when a folder linked but its first sync failed", async () => {
    renderDialog();
    await previewFolder();
    await click(button("Link folder"));
    const { act } = await import("react");
    await act(async () =>
      lastCall()[1].onSuccess?.({
        dryRun: false,
        database: {} as LinkGitHubFolderResponse["database"],
        preview,
        source: null,
        summary: "",
        sync: {
          state: "error",
          commitSha: null,
          created: 0,
          updated: 0,
          renamed: 0,
          trashed: 0,
          remaining: 0,
          problem: { code: "connection", message: "Reconnect GitHub." },
        },
      }),
    );
    expect(toasts.toast.success).not.toHaveBeenCalled();
    expect(toasts.toast.error).toHaveBeenCalledWith(
      "Linked acme/handbook/docs, but its first sync failed",
      { description: expect.stringContaining("GitHub") },
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("says why a collection with pages can't be linked", async () => {
    renderDialog();
    await previewFolder(
      dryRun({ canLink: false, blockedReason: "collection-has-rows" }),
    );
    expect(document.body.textContent).toContain(
      "This collection already has pages. Link a GitHub folder from a new, empty collection.",
    );
    expect(button("Link folder").disabled).toBe(true);
  });

  it.each(["connection_required", "GITHUB_CONNECTION"])(
    "offers to connect GitHub when the preview fails with %s",
    async (errorCode) => {
      renderDialog();
      await typeInto(urlInput(), FOLDER_URL);
      await click(button("Preview"));
      const { act } = await import("react");
      await act(async () =>
        lastCall()[1].onError?.(
          Object.assign(new Error("Connect GitHub"), { errorCode }),
        ),
      );
      expect(document.body.textContent).toContain(
        "Connect GitHub so Content can read this repository.",
      );

      await click(button("Connect GitHub"));
      expect(oauth.start).toHaveBeenCalledWith(
        "github",
        expect.objectContaining({ appId: "content", scope: "user" }),
      );
    },
  );

  it("starts over when the link changes after a preview", async () => {
    renderDialog();
    await previewFolder();
    await typeInto(urlInput(), `${FOLDER_URL}/guides`);
    expect(document.querySelector("[data-github-folder-preview]")).toBe(null);
    expect(button("Link folder").disabled).toBe(true);
  });
});
