import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Response,
} from "@playwright/test";

import { knownLossSpec } from "../../acceptance/known-loss";
import {
  AGENT_MARKDOWN_BODY,
  EDITOR,
  EDITOR_BODY,
  PAGE_PARAGRAPHS,
  createPage,
  expectEditorReady,
  postAction,
  signInAccount,
} from "../helpers";
import { enterGateArm, leaveGateArm } from "../live-body-gate";
import { liveCopyContaining } from "./collab-blocks";

// SF-06: every editor visit mounts one editor. Each case counts the
// record-editor-mount calls the visit sends and follows the `.ProseMirror`
// node from the first frame it appears until the visit settles.

test.describe.configure({ retries: 0, timeout: 120_000 });

// A remount can land after the editor turns editable: the live copy may arrive
// late on a slow network. The visit keeps counting for this long after the
// editor is ready, so a late remount still fails the case.
const SETTLE_MS = 6_000;

const MOUNT_PATH = "/_agent-native/actions/record-editor-mount";

const REMOUNT_LOSS = knownLossSpec({
  lane: "L4a",
  outcome: "SF-06",
  reason:
    "Main mounts a read-only editor, then replaces it with a second editor when the page's live copy arrives, and reports the visit as initial then remount.",
});

// Gives every `.ProseMirror` node the visit creates a record: when it appeared,
// when it first became editable, and when it left the document. Nodes already
// on screen when a visit starts belong to the visit before it.
const WATCH_EDITOR_NODES = `
(() => {
  const selector = ${JSON.stringify(EDITOR)};
  let ignored = new WeakSet();
  let tracked = [];
  const records = new WeakMap();
  const scan = () => {
    const now = performance.now();
    for (const el of document.querySelectorAll(selector)) {
      if (ignored.has(el)) continue;
      let record = records.get(el);
      if (!record) {
        record = { addedAt: now, editableAt: null, removedAt: null };
        records.set(el, record);
        tracked.push([el, record]);
      }
      if (record.editableAt === null && el.getAttribute("contenteditable") === "true")
        record.editableAt = now;
    }
    for (const [el, record] of tracked)
      if (record.removedAt === null && !el.isConnected) record.removedAt = now;
  };
  new MutationObserver(scan).observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["contenteditable"],
  });
  globalThis.__editorNodes = () => {
    scan();
    return tracked.map(([, record]) => record);
  };
  globalThis.__startEditorVisit = () => {
    scan();
    ignored = new WeakSet(document.querySelectorAll(selector));
    tracked = [];
  };
})();
`;

interface EditorNode {
  addedAt: number;
  editableAt: number | null;
  removedAt: number | null;
}

interface MountReport {
  id: string;
  visitId: string;
  outcome: string;
  mode: string;
}

/**
 * The mount reports one tab's server accepted. A report the client retried
 * after a failed attempt is counted once, as the server counts it. A tab's
 * first visit starts when it opens; a later one starts at startVisit().
 */
class MountReports {
  readonly accepted: MountReport[] = [];
  private visitStart = 0;

  constructor(page: Page) {
    page.on("response", (response: Response) => {
      const request = response.request();
      if (
        request.method() !== "POST" ||
        new URL(request.url()).pathname !== MOUNT_PATH ||
        !response.ok()
      )
        return;
      this.accepted.push(JSON.parse(request.postData() ?? "{}") as MountReport);
    });
  }

  startVisit(): void {
    this.visitStart = this.accepted.length;
  }

  /** The reports for `documentId` since the current visit started. */
  thisVisit(documentId: string): MountReport[] {
    return this.accepted
      .slice(this.visitStart)
      .filter((report) => report.id === documentId);
  }
}

async function openTab(context: BrowserContext): Promise<{
  page: Page;
  mounts: MountReports;
}> {
  const page = await context.newPage();
  await page.addInitScript(WATCH_EDITOR_NODES);
  return { page, mounts: new MountReports(page) };
}

async function editorNodes(page: Page): Promise<EditorNode[]> {
  return page.evaluate(() =>
    (
      globalThis as unknown as { __editorNodes: () => EditorNode[] }
    ).__editorNodes(),
  );
}

async function startVisit(tab: {
  page: Page;
  mounts: MountReports;
}): Promise<void> {
  await tab.page.evaluate(() =>
    (
      globalThis as unknown as { __startEditorVisit: () => void }
    ).__startEditorVisit(),
  );
  tab.mounts.startVisit();
}

/**
 * Wait for the visit's editor, let it settle, then require one editor node
 * that lived from its first frame to the end of the visit, and one mount
 * report of the expected kind.
 */
async function expectOneMount(
  page: Page,
  mounts: MountReports,
  documentId: string,
  expected: { outcome: "initial" | "navigation"; mode: string },
): Promise<void> {
  if (expected.mode === "readonly") {
    await expect(page.locator(EDITOR)).toHaveAttribute(
      "contenteditable",
      "false",
      { timeout: 60_000 },
    );
  } else {
    await expectEditorReady(page);
  }
  await page.waitForTimeout(SETTLE_MS);

  const nodes = await editorNodes(page);
  const reports = mounts.thisVisit(documentId);
  const evidence = JSON.stringify({ nodes, reports });
  expect(nodes.length, `editor nodes this visit created: ${evidence}`).toBe(1);
  expect(
    nodes[0].removedAt,
    `the first editor node left the page: ${evidence}`,
  ).toBeNull();
  if (expected.mode !== "readonly")
    expect(
      nodes[0].editableAt,
      `the first editor node never became editable: ${evidence}`,
    ).not.toBeNull();
  expect(
    reports.map((report) => `${report.outcome}:${report.mode}`),
    `record-editor-mount calls this visit sent: ${evidence}`,
  ).toEqual([`${expected.outcome}:${expected.mode}`]);
}

/**
 * Open a page holding EDITOR_BODY once, wait until the browser has seeded its
 * live copy, then close the tab.
 */
async function seedLiveCopy(
  context: BrowserContext,
  documentId: string,
): Promise<void> {
  const page = await context.newPage();
  await page.goto(`/page/${documentId}`, { waitUntil: "domcontentloaded" });
  await expectEditorReady(page);
  await liveCopyContaining(page, documentId, PAGE_PARAGRAPHS);
  await page.close();
}

test.describe(
  "SF-06 each editor visit mounts the editor once",
  {
    tag: "@SF-06",
  },
  () => {
    test(
      "a fresh load of a page opened before",
      REMOUNT_LOSS,
      async ({ page, context }) => {
        const id = await createPage(page, "SF-06 fresh load", EDITOR_BODY);
        await enterGateArm(page, id);
        await seedLiveCopy(context, id);

        const tab = await openTab(context);
        await tab.page.goto(`/page/${id}`, { waitUntil: "domcontentloaded" });
        await expectOneMount(tab.page, tab.mounts, id, {
          outcome: "initial",
          mode: "editing",
        });
      },
    );

    test(
      "the first open of a page no browser has seeded",
      REMOUNT_LOSS,
      async ({ page, context }) => {
        const id = await createPage(page, "SF-06 never seeded", EDITOR_BODY);
        await enterGateArm(page, id);

        const tab = await openTab(context);
        await tab.page.goto(`/page/${id}`, { waitUntil: "domcontentloaded" });
        await expectOneMount(tab.page, tab.mounts, id, {
          outcome: "initial",
          mode: "editing",
        });
      },
    );

    test(
      "landing on /home, which reopens the last page",
      REMOUNT_LOSS,
      async ({ page, browser, baseURL }) => {
        // /home reopens the account's last page, and parallel workers open
        // pages as the shared account, so this case signs in as one of its own.
        const landing = await browser.newContext({
          baseURL,
          storageState: { cookies: [], origins: [] },
        });
        let reader: Page | undefined;
        try {
          reader = await signIn(
            landing,
            baseURL!,
            await landingAccountEmail(page),
            "SF-06 landing",
          );
          const id = await createPage(
            reader,
            "SF-06 home landing",
            EDITOR_BODY,
          );
          await enterGateArm(reader, id);
          await seedLiveCopy(landing, id);

          const tab = await openTab(landing);
          await tab.page.goto("/home", { waitUntil: "domcontentloaded" });
          await expect(tab.page).toHaveURL(new RegExp(`/page/${id}`), {
            timeout: 30_000,
          });
          await expectOneMount(tab.page, tab.mounts, id, {
            outcome: "initial",
            mode: "editing",
          });
        } finally {
          try {
            if (reader) await leaveGateArm(reader);
          } finally {
            await landing.close();
          }
        }
      },
    );

    test(
      "moving to another page inside the app",
      REMOUNT_LOSS,
      async ({ page, context }) => {
        const from = await createPage(page, "SF-06 navigate from", EDITOR_BODY);
        const to = await createPage(page, "SF-06 navigate to", EDITOR_BODY);
        await enterGateArm(page, from);
        await enterGateArm(page, to);

        const tab = await openTab(context);
        await tab.page.goto(`/page/${from}`, { waitUntil: "domcontentloaded" });
        await expectEditorReady(tab.page);
        await tab.page.waitForTimeout(SETTLE_MS);

        await startVisit(tab);
        await tab.page.locator(`a[href$="/page/${to}"]`).first().click();
        await expect(tab.page).toHaveURL(new RegExp(`/page/${to}`));
        await expectOneMount(tab.page, tab.mounts, to, {
          outcome: "navigation",
          mode: "editing",
        });
      },
    );

    test("a page the reader may only view", async ({
      page,
      browser,
      baseURL,
    }) => {
      const id = await createPage(page, "SF-06 read only", EDITOR_BODY);
      await enterGateArm(page, id);
      const viewerEmail = `sf06-viewer+autoz-${Date.now().toString(36)}@content.test`;
      const viewer = await browser.newContext({
        baseURL,
        storageState: { cookies: [], origins: [] },
      });
      try {
        await signIn(viewer, baseURL!, viewerEmail, "SF-06 viewer");
        await postAction(page, "share-resource", {
          resourceType: "document",
          resourceId: id,
          principalType: "user",
          principalId: viewerEmail,
          role: "viewer",
          notify: false,
        });

        const tab = await openTab(viewer);
        await tab.page.goto(`/page/${id}`, { waitUntil: "domcontentloaded" });
        await expectOneMount(tab.page, tab.mounts, id, {
          outcome: "initial",
          mode: "readonly",
        });
      } finally {
        await viewer.close();
      }
    });

    test(
      "a page an agent wrote in its own Markdown form",
      REMOUNT_LOSS,
      async ({ page, context }) => {
        const id = await createPage(
          page,
          "SF-06 agent form",
          `${AGENT_MARKDOWN_BODY}\n\nsnake\\_case and __bold__ cost $60.`,
        );
        await enterGateArm(page, id);

        const tab = await openTab(context);
        await tab.page.goto(`/page/${id}`, { waitUntil: "domcontentloaded" });
        await expectOneMount(tab.page, tab.mounts, id, {
          outcome: "initial",
          mode: "editing",
        });
      },
    );

    test(
      "a page holding the reader's recovery draft",
      REMOUNT_LOSS,
      async ({ page, context }) => {
        const id = await createPage(page, "SF-06 recovery draft", EDITOR_BODY);
        await enterGateArm(page, id);
        await seedLiveCopy(context, id);
        await postAction(page, "update-preview-document-draft", {
          operation: "upsert",
          documentId: id,
          expectedVersion: null,
          draft: {
            title: "SF-06 recovery draft",
            content: `${EDITOR_BODY}\nA draft line the server never saved.`,
            baseDocumentUpdatedAt: null,
            loadedContentWasEmpty: false,
            deferredReason: "conflict",
          },
        });

        const tab = await openTab(context);
        await tab.page.goto(`/page/${id}`, { waitUntil: "domcontentloaded" });
        await expectOneMount(tab.page, tab.mounts, id, {
          outcome: "initial",
          mode: "editing",
        });
      },
    );
  },
);

/**
 * The /home case's own account, named after the run's shared account so each
 * gate arm gets its own. CI's gate-on steps allowlist it as a flag admin.
 */
async function landingAccountEmail(page: Page): Promise<string> {
  const session = await page.request.get("/_agent-native/auth/session");
  const { email } = (await session.json()) as { email?: string };
  expect(email, "the shared account's session has no email").toBeTruthy();
  return email!.replace("@", "-landing@");
}

/** A page in `context`, signed in as `email`. */
async function signIn(
  context: BrowserContext,
  baseURL: string,
  email: string,
  name: string,
): Promise<Page> {
  const page = await context.newPage();
  const password = ["example", "sf06", "account", "pw"].join("-");
  const result = await signInAccount(page.request, baseURL, {
    email,
    password,
    name,
  });
  const evidence = JSON.stringify(result);
  expect(result.sessionEmail, `sign in ${email}: ${evidence}`).toBe(email);
  expect(result.firstRunStatus, `first-run ${email}: ${evidence}`).toBe(200);
  return page;
}
