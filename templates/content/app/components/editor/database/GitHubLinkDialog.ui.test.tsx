// @vitest-environment happy-dom
import type { GitHubFolderPreview } from "@shared/github-source";
import { act } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CreateGitHubCollectionResponse,
  GitHubFolderSyncSummary,
  LinkGitHubFolderResponse,
} from "@/hooks/use-github-folder";
import {
  openGitHubLinkDialog,
  type GitHubLinkDialogRequest,
} from "@/lib/github-link-dialog";
import { click, renderUi, typeInto } from "@/test-utils/render-ui";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const calls = vi.hoisted(() => ({
  link: [] as Array<{ args: unknown; answer: Deferred<unknown> }>,
  create: [] as Array<{ args: unknown; answer: Deferred<unknown> }>,
}));
const connection = vi.hoisted(() => ({
  isPending: false,
  data: { connected: true } as { connected: boolean | null } | undefined,
}));
const toasts = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
const oauth = vi.hoisted(() => ({ start: vi.fn() }));
const navigate = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/integrations", () => ({
  startWorkspaceProviderOAuth: oauth.start,
}));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => navigate,
}));
vi.mock("@/hooks/use-documents", () => ({
  startPageOpenDocumentReads: vi.fn(),
}));
vi.mock("@/hooks/use-github-folder", () => {
  function mutation(list: typeof calls.link) {
    return {
      mutateAsync: (args: unknown) => {
        const answer = deferred<unknown>();
        list.push({ args, answer });
        return answer.promise;
      },
    };
  }
  return {
    useLinkGitHubFolder: () => mutation(calls.link),
    useCreateGitHubCollection: () => mutation(calls.create),
    useGitHubConnection: () => connection,
  };
});
vi.mock("sonner", () => ({ toast: toasts.toast }));

import { GitHubLinkDialog, GitHubLinkDialogHost } from "./GitHubLinkDialog";

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
    { key: "featured", type: "checkbox", examples: ["true"] },
  ],
  sample: [
    { path: "faq.md", title: "FAQ" },
    { path: "guides/getting-started.md", title: "Getting started" },
    { path: "guides/style.md", title: "Style" },
    { path: "api.md", title: "API reference" },
  ],
  sampledFiles: 4,
  images: 1,
  storageReady: false,
};

const synced: GitHubFolderSyncSummary = {
  state: "synced",
  commitSha: preview.commitSha,
  created: 4,
  updated: 0,
  renamed: 0,
  trashed: 0,
  remaining: 0,
  problem: null,
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

function queryButton(name: string) {
  return (
    Array.from(document.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === name,
    ) ?? null
  );
}

function urlInput() {
  const input = document.querySelector<HTMLInputElement>("#github-folder-url");
  if (!input) throw new Error("No folder link input");
  return input;
}

function summaryText() {
  return (
    document.querySelector("[data-github-folder-preview]")?.textContent ?? ""
  );
}

async function answer<T>(
  call: { answer: Deferred<unknown> } | undefined,
  value: T,
) {
  if (!call) throw new Error("No call to answer");
  await act(async () => {
    call.answer.resolve(value);
    await call.answer.promise;
  });
}

async function fail(
  call: { answer: Deferred<unknown> } | undefined,
  error: unknown,
) {
  if (!call) throw new Error("No call to fail");
  await act(async () => {
    call.answer.reject(error);
    await call.answer.promise.catch(() => undefined);
  });
}

function lastLink() {
  return calls.link[calls.link.length - 1];
}

function lastCreate() {
  return calls.create[calls.create.length - 1];
}

async function checkFolder(response: LinkGitHubFolderResponse = dryRun()) {
  await typeInto(urlInput(), FOLDER_URL);
  await click(button("Check folder"));
  await answer(lastLink(), response);
}

const collectionRequest: GitHubLinkDialogRequest = {
  target: {
    kind: "collection",
    databaseId: "database-1",
    documentId: "doc-1",
    spaceId: "space-1",
    parentId: "parent-1",
  },
};

describe("GitHub link dialog", () => {
  const onOpenChange = vi.fn();

  beforeEach(() => {
    calls.link.length = 0;
    calls.create.length = 0;
    connection.isPending = false;
    connection.data = { connected: true };
    onOpenChange.mockReset();
    oauth.start.mockReset();
    navigate.mockReset();
    toasts.toast.success.mockReset();
    toasts.toast.error.mockReset();
  });

  function renderDialog(request: GitHubLinkDialogRequest = collectionRequest) {
    renderUi(
      <MemoryRouter initialEntries={["/page/doc-1"]}>
        <GitHubLinkDialog request={request} open onOpenChange={onOpenChange} />
      </MemoryRouter>,
    );
  }

  it("asks to connect GitHub before any typing, and comes back to the dialog", async () => {
    connection.data = { connected: false };
    renderDialog();
    expect(document.querySelector("#github-folder-url")).toBe(null);
    expect(document.body.textContent).toContain(
      "Connect your GitHub account so Content can read your folders.",
    );

    await click(button("Connect GitHub"));
    const [provider, options] = oauth.start.mock.calls[0] ?? [];
    expect(provider).toBe("github");
    expect(options).toMatchObject({ appId: "content", scope: "user" });
    const returnTo = new URL(options.returnPath, "https://content.test");
    expect(returnTo.searchParams.get("githubLink")).toBe("collection");
    expect(returnTo.searchParams.get("githubId")).toBe("database-1");
    expect(returnTo.searchParams.get("githubPage")).toBe("doc-1");
  });

  it("says it's checking the connection before showing the link field", () => {
    connection.isPending = true;
    connection.data = undefined;
    renderDialog();
    expect(document.body.textContent).toContain(
      "Checking your GitHub connection…",
    );
    expect(document.querySelector("#github-folder-url")).toBe(null);
  });

  it("turns a file link into its folder, without calling GitHub first", async () => {
    renderDialog();
    await typeInto(
      urlInput(),
      "https://github.com/acme/handbook/blob/main/docs/faq.md",
    );
    await click(button("Check folder"));
    expect(calls.link).toHaveLength(0);
    expect(document.body.textContent).toContain("That’s a link to one file.");

    await click(button("Use the “docs” folder"));
    expect(urlInput().value).toBe(FOLDER_URL);
    expect(lastLink()?.args).toEqual({
      databaseId: "database-1",
      url: FOLDER_URL,
      dryRun: true,
    });
  });

  it("sums the folder up in a few plain lines, with the rest behind Show details", async () => {
    renderDialog();
    await checkFolder();

    const text = summaryText();
    expect(text).toContain("docs, in handbook");
    expect(text).toContain("4 pages: FAQ, Getting started, Style, and 1 more.");
    expect(text).toContain("Columns: status, published, and featured.");
    expect(text).toContain("2 files won’t show yet.");
    expect(text).toContain(
      "Pictures in these files won’t show until a workspace admin sets up file storage.",
    );
    expect(text).not.toContain("editor.propertyTypes");
    expect(button("Link 4 pages").disabled).toBe(false);

    await click(button("Show details"));
    const details =
      document.querySelector("[data-github-folder-details]")?.textContent ?? "";
    expect(details).toContain("FAQfaq.md");
    expect(details).toContain("publishededitor.propertyTypes.dateSep 1, 2026");
    expect(details).toContain("featurededitor.propertyTypes.checkboxYes");
    expect(details).toContain("demo.mdxUses MDX, which Content can’t show yet");
    expect(details).toContain("Branch main · version 65b1d83");
    expect(details).not.toContain("Read from");
  });

  it("calls the page count a ceiling when only some files were read", async () => {
    renderDialog();
    await checkFolder(
      dryRun({ preview: { ...preview, markdownFiles: 300, sampledFiles: 25 } }),
    );
    expect(summaryText()).toContain("Up to 300 pages:");
    expect(button("Link up to 300 pages").disabled).toBe(false);
    await click(button("Show details"));
    expect(summaryText()).toContain(
      "Read from the first 25 of 300 files. Others can add columns.",
    );
  });

  it("links the checked folder, says so, and closes", async () => {
    renderDialog();
    await checkFolder();

    await click(button("Link 4 pages"));
    expect(lastLink()?.args).toEqual({
      databaseId: "database-1",
      url: FOLDER_URL,
    });
    expect(document.body.textContent).toContain(
      "Bringing in 4 pages from GitHub…",
    );
    expect(queryButton("Close")).toBe(null);
    await answer(lastLink(), {
      dryRun: false,
      database: {} as LinkGitHubFolderResponse["database"],
      preview,
      source: null,
      summary: "",
      sync: synced,
    } satisfies LinkGitHubFolderResponse);
    expect(toasts.toast.success).toHaveBeenCalledWith(
      "Linked. 4 pages from docs are here.",
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("says when a folder linked but its pages couldn't come in yet", async () => {
    renderDialog();
    await checkFolder();
    await click(button("Link 4 pages"));
    await answer(lastLink(), {
      dryRun: false,
      database: {} as LinkGitHubFolderResponse["database"],
      preview,
      source: null,
      summary: "",
      sync: {
        ...synced,
        state: "error",
        created: 0,
        problem: { code: "folder_not_found", message: "Gone." },
      },
    } satisfies LinkGitHubFolderResponse);
    expect(toasts.toast.success).not.toHaveBeenCalled();
    expect(toasts.toast.error).toHaveBeenCalledWith(
      "Linked docs, but couldn’t bring pages in yet.",
      {
        description:
          "Stopped updating: the “docs” folder is gone from that branch.",
      },
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("names what was typed when the folder can't be found", async () => {
    renderDialog();
    await typeInto(
      urlInput(),
      "https://github.com/acme/handbook/tree/main/dcos",
    );
    await click(button("Check folder"));
    await fail(
      lastLink(),
      Object.assign(new Error("Not found"), {
        errorCode: "GITHUB_FOLDER_NOT_FOUND",
      }),
    );
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "There’s no folder called “dcos” in handbook. Check the link.",
    );
  });

  it.each(["connection_required", "GITHUB_CONNECTION"])(
    "switches to the connect step when a check fails with %s",
    async (errorCode) => {
      renderDialog();
      await typeInto(urlInput(), FOLDER_URL);
      await click(button("Check folder"));
      await fail(
        lastLink(),
        Object.assign(new Error("Connect GitHub"), { errorCode }),
      );
      expect(document.querySelector("[data-github-connect-step]")).not.toBe(
        null,
      );
      await click(button("Connect GitHub"));
      const returnTo = new URL(
        oauth.start.mock.calls[0]?.[1].returnPath,
        "https://content.test",
      );
      expect(returnTo.searchParams.get("githubUrl")).toBe(FOLDER_URL);
    },
  );

  it("offers a new collection when this one can't take the folder", async () => {
    renderDialog();
    await checkFolder(
      dryRun({ canLink: false, blockedReason: "collection-has-rows" }),
    );
    expect(summaryText()).toContain(
      "This collection has pages now, so a GitHub folder can’t fill it.",
    );
    expect(button("Check folder").disabled).toBe(true);

    await click(button("New collection from GitHub"));
    expect(document.body.textContent).toContain(
      "New collection from a GitHub folder",
    );
    expect(lastCreate()?.args).toEqual({
      url: FOLDER_URL,
      spaceId: "space-1",
      parentId: "parent-1",
      dryRun: true,
    });
  });

  it("checks a pasted link right away", async () => {
    renderDialog();
    const input = urlInput();
    await act(async () => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.assign(event, {
        clipboardData: { getData: () => `  ${FOLDER_URL} ` },
      });
      input.dispatchEvent(event);
    });
    expect(input.value).toBe(FOLDER_URL);
    expect(lastLink()?.args).toEqual({
      databaseId: "database-1",
      url: FOLDER_URL,
      dryRun: true,
    });
  });

  it("drops a check that answers after the link changed", async () => {
    renderDialog();
    await typeInto(urlInput(), FOLDER_URL);
    await click(button("Check folder"));
    const stale = lastLink();
    await typeInto(urlInput(), `${FOLDER_URL}/guides`);
    await answer(stale, dryRun());
    expect(document.querySelector("[data-github-folder-preview]")).toBe(null);
    expect(button("Check folder").disabled).toBe(false);
  });

  it("makes a new collection from the folder and opens it", async () => {
    renderDialog({
      target: { kind: "new", spaceId: "space-1", parentId: null },
    });
    expect(document.body.textContent).toContain(
      "Content makes a collection named after the folder.",
    );
    await typeInto(urlInput(), FOLDER_URL);
    await click(button("Check folder"));
    await answer(lastCreate(), {
      dryRun: true,
      preview,
      title: "docs",
      summary: "",
    } satisfies CreateGitHubCollectionResponse);

    await click(button("Link 4 pages"));
    expect(lastCreate()?.args).toEqual({
      url: FOLDER_URL,
      spaceId: "space-1",
      parentId: null,
    });
    await answer(lastCreate(), {
      dryRun: false,
      database: {
        documentId: "new-doc",
      } as Extract<
        CreateGitHubCollectionResponse,
        { dryRun: false }
      >["database"],
      preview,
      title: "docs",
      source: null,
      summary: "",
      sync: synced,
    } satisfies CreateGitHubCollectionResponse);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(navigate).toHaveBeenCalledWith("/page/new-doc");
  });
});

describe("GitHub link dialog host", () => {
  beforeEach(() => {
    calls.link.length = 0;
    connection.isPending = false;
    connection.data = { connected: true };
    navigate.mockReset();
  });

  it("opens when asked from anywhere in the app", async () => {
    renderUi(
      <MemoryRouter initialEntries={["/page/doc-1"]}>
        <GitHubLinkDialogHost />
      </MemoryRouter>,
    );
    expect(document.querySelector("#github-folder-url")).toBe(null);
    await act(async () => openGitHubLinkDialog(collectionRequest));
    expect(document.querySelector("#github-folder-url")).not.toBe(null);
  });

  it("reopens after GitHub's sign-in, checks the carried link, and tidies the address", async () => {
    const search = new URLSearchParams({
      view: "table",
      githubLink: "collection",
      githubId: "database-1",
      githubPage: "doc-1",
      githubUrl: FOLDER_URL,
    });
    renderUi(
      <MemoryRouter initialEntries={[`/page/doc-1?${search.toString()}`]}>
        <GitHubLinkDialogHost />
      </MemoryRouter>,
    );
    await act(async () => undefined);
    expect(urlInput().value).toBe(FOLDER_URL);
    expect(lastLink()?.args).toEqual({
      databaseId: "database-1",
      url: FOLDER_URL,
      dryRun: true,
    });
    expect(navigate).toHaveBeenCalledWith(
      { pathname: "/page/doc-1", search: "?view=table", hash: "" },
      { replace: true },
    );
  });
});
