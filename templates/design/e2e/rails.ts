import {
  expect,
  test as base,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { parse } from "parse5";

import { appPath, gotoEditor } from "./helpers";

const NODE_ID = "data-agent-native-node-id";
const SAVE_REQUEST =
  /\/_agent-native\/actions\/(update-file|update-design|create-file|delete-file|replace-source-node|apply-[\w-]+)(\?|$)/;
const SAVE_DEBOUNCE_QUIET_MS = 600;
const LIVE_SCREEN_IFRAME =
  'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])';

type Failure = { kind: string; detail: string };
type Screen = string | { fileId: string };

export type SavedNode = {
  id: string;
  tag: string;
  parent: string | null;
  index: number;
  attrs: Record<string, string>;
  text: string;
};

export class App {
  private readonly failures: Failure[] = [];
  private readonly allowed: { pattern: RegExp; reason: string }[] = [];
  private readonly designs: string[] = [];
  private readonly screenIds = new Map<string, string>();
  private inflightSaves = 0;
  private recording = true;
  private lastSaveActivity = 0;

  constructor(readonly page: Page) {}

  async attach() {
    const page = this.page;
    // Playwright can't say who started a navigation, so the test's own navigations are counted on the way in.
    let expectedLoads = 0;
    for (const method of [
      "goto",
      "reload",
      "goBack",
      "goForward",
      "setContent",
    ] as const) {
      const navigate = page[method].bind(page) as (
        ...args: unknown[]
      ) => Promise<unknown>;
      Object.assign(page, {
        [method]: (...args: unknown[]) => {
          expectedLoads += 1;
          return navigate(...args);
        },
      });
    }
    page.on("load", () => {
      if (expectedLoads > 0) {
        expectedLoads -= 1;
        return;
      }
      if (this.recording) {
        this.failures.push({
          kind: "unexpected page load",
          detail: `${page.url()} loaded without the test navigating`,
        });
      }
    });
    page.on("pageerror", (error) => {
      if (this.recording)
        this.failures.push({
          kind: "pageerror",
          detail: error.stack ?? String(error),
        });
    });
    page.on("console", (message) => {
      if (this.recording && message.type() === "error") {
        this.failures.push({ kind: "console.error", detail: message.text() });
      }
    });
    page.on("request", (request) => {
      if (request.method() === "POST" && SAVE_REQUEST.test(request.url())) {
        this.inflightSaves += 1;
        this.lastSaveActivity = Date.now();
      }
    });
    const saveDone = (request: { method(): string; url(): string }) => {
      if (request.method() === "POST" && SAVE_REQUEST.test(request.url())) {
        this.inflightSaves = Math.max(0, this.inflightSaves - 1);
        this.lastSaveActivity = Date.now();
      }
    };
    page.on("requestfinished", saveDone);
    page.on("requestfailed", saveDone);
    // A save the old document sent as it unloaded (a pagehide keepalive) never reports finishing.
    page.on("domcontentloaded", () => {
      this.inflightSaves = 0;
      this.lastSaveActivity = Date.now();
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (
        this.recording &&
        url.pathname.includes("/_agent-native/") &&
        response.status() >= 400
      ) {
        this.failures.push({
          kind: `http ${response.status()}`,
          detail: `${response.request().method()} ${url.pathname}`,
        });
      }
    });
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { __e2eErrorToasts: string[] }).__e2eErrorToasts =
        seen;
      new MutationObserver(() => {
        for (const toast of document.querySelectorAll(
          '[data-sonner-toast][data-type="error"]',
        )) {
          const text = (toast.textContent ?? "").trim();
          if (text && !seen.includes(text)) seen.push(text);
        }
      }).observe(document, { childList: true, subtree: true });
    });
  }

  /** A failure the test expects; anything else fails the test at teardown. */
  allowFailure(pattern: RegExp, reason: string) {
    this.allowed.push({ pattern, reason });
  }

  async seed(
    html: string,
    options: { title?: string; files?: Record<string, string> } = {},
  ) {
    const { id } = (await this.action("create-design", {
      title: options.title ?? "e2e",
      projectType: "prototype",
    })) as { id: string };
    this.designs.push(id);
    const files = { "index.html": html, ...options.files };
    for (const [filename, content] of Object.entries(files)) {
      const file = await this.action("create-file", {
        designId: id,
        filename,
        content,
        fileType: "html",
      });
      this.screenIds.set(filename, file.id);
    }
    return id;
  }

  /** Deletes at teardown a design the scenario created through the product (Home, open-visual-edit) rather than `seed`. */
  adopt(designId: string) {
    this.designs.push(designId);
  }

  async open(designId: string) {
    await gotoEditor(this.page, designId);
  }

  /** Zooms through the toolbar's zoom menu, the way a designer does before precise work. */
  async zoomTo100() {
    const zoom = this.page
      .getByRole("button")
      .filter({ hasText: /^\s*\d+%\s*$/ })
      .first();
    await zoom.click();
    await this.page.getByRole("menuitem", { name: "Zoom to 100%" }).click();
    await expect(zoom).toHaveText(/^\s*100%\s*$/);
  }

  /** Shift+1, then waits until the screen stops moving so coordinates read afterwards are final. */
  async zoomToFit() {
    const frame = this.page.locator(LIVE_SCREEN_IFRAME).first();
    const before = JSON.stringify(await frame.boundingBox());
    await this.page.keyboard.press("Shift+1");
    let previous = "";
    await expect
      .poll(
        async () => {
          const now = JSON.stringify(await frame.boundingBox());
          const stable = now === previous && now !== before;
          previous = now;
          return stable;
        },
        {
          intervals: [100],
          timeout: 10_000,
          message: "the canvas never settled after zoom to fit",
        },
      )
      .toBe(true);
  }

  async selectedLayers() {
    return this.page
      .locator('[role="treeitem"][aria-selected="true"]')
      .allInnerTexts();
  }

  /**
   * Waits until no save is in flight and none has been sent for longer than the client's save debounce,
   * measured from this call: the save for the gesture just made may not have been sent yet.
   */
  async settled(timeout = 20_000) {
    const since = Date.now();
    await expect
      .poll(
        () =>
          this.inflightSaves === 0 &&
          Date.now() - Math.max(this.lastSaveActivity, since) >
            SAVE_DEBOUNCE_QUIET_MS,
        { timeout, message: "a save never settled" },
      )
      .toBe(true);
  }

  /** The design as the server stores it: its files and its `data` (canvas frames, board objects, metadata). */
  async savedRecord(designId: string) {
    const response = await this.page.request.get(
      appPath(`/_agent-native/actions/get-design?id=${designId}`),
    );
    expect(response.ok(), `get-design ${response.status()}`).toBe(true);
    const record = (await response.json()) as {
      data: string | Record<string, unknown> | null;
      files: { id: string; filename: string; content?: string }[];
    };
    const data =
      typeof record.data === "string"
        ? (JSON.parse(record.data) as Record<string, unknown>)
        : record.data;
    return { ...record, data };
  }

  async savedHtml(designId: string, filename = "index.html") {
    const record = await this.savedRecord(designId);
    const file = record.files.find(
      (candidate) => candidate.filename === filename,
    );
    if (!file?.content) throw new Error(`saved design has no ${filename}`);
    return file.content;
  }

  async savedNodes(designId: string, filename = "index.html") {
    return savedNodeMap(await this.savedHtml(designId, filename));
  }

  /**
   * The live screen iframe, never a breakpoint copy or the board. `screen` is a filename passed to `seed`, or
   * `{ fileId }` for a screen the scenario created in the editor; omit it only when the design has one screen.
   */
  private screenFrame(screen?: Screen) {
    if (screen === undefined) return this.page.locator(LIVE_SCREEN_IFRAME);
    const id =
      typeof screen === "string" ? this.screenIds.get(screen) : screen.fileId;
    if (!id) throw new Error(`no seeded screen named ${String(screen)}`);
    return this.page.locator(
      `iframe[data-design-preview-iframe][data-screen-iframe-id="${id}"]`,
    );
  }

  node(nodeId: string, screen?: Screen) {
    return this.screenFrame(screen)
      .contentFrame()
      .locator(`[${NODE_ID}="${nodeId}"]`);
  }

  /** The node's box inside its screen document, in design (CSS) pixels. */
  async designRect(nodeId: string, screen?: Screen) {
    return this.node(nodeId, screen).evaluate((element) => {
      const r = element.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    });
  }

  /** Page coordinates of a point given in the screen's design pixels. */
  async pagePoint(designX: number, designY: number, screen?: Screen) {
    const frame = this.screenFrame(screen);
    const box = await frame.boundingBox();
    if (!box) throw new Error("screen iframe has no box");
    const width = await frame.evaluate(
      (iframe: HTMLIFrameElement) =>
        iframe.contentDocument!.documentElement.clientWidth,
    );
    const scale = box.width / width;
    return { x: box.x + designX * scale, y: box.y + designY * scale, scale };
  }

  async teardown(testInfo: TestInfo) {
    let toasts: string[] = [];
    if (!this.page.isClosed()) {
      await this.settled().catch(() => {
        this.failures.push({
          kind: "unsettled",
          detail: "a save was still in flight at teardown",
        });
      });
      toasts = await this.page
        .evaluate(
          () =>
            (window as unknown as { __e2eErrorToasts?: string[] })
              .__e2eErrorToasts ?? [],
        )
        .catch((error: Error) => {
          this.failures.push({
            kind: "error toasts unreadable",
            detail: error.message,
          });
          return [];
        });
      // coercion-ok: the final-state screenshot is evidence only; no test passes or fails on it
      const finalState = await this.page.screenshot().catch(() => null);
      if (finalState)
        await testInfo.attach("final state", {
          body: finalState,
          contentType: "image/png",
        });
      this.recording = false;
      await this.page.goto("about:blank").catch(() => {});
    }
    for (const id of this.designs)
      await this.action("delete-design", { id }).catch(() => {});
    const unexpected = [
      ...this.failures,
      ...toasts.map((detail) => ({ kind: "error toast", detail })),
    ].filter(
      (failure) =>
        !this.allowed.some(({ pattern }) =>
          pattern.test(`${failure.kind} ${failure.detail}`),
        ),
    );
    if (unexpected.length && testInfo.status === testInfo.expectedStatus) {
      throw new Error(
        `The app reported failures during this test:\n${unexpected
          .map(
            (failure) => `  - ${failure.kind}: ${failure.detail.slice(0, 700)}`,
          )
          .join("\n")}`,
      );
    }
  }

  private async action(name: string, body: unknown) {
    const response = await this.page.request.post(
      appPath(`/_agent-native/actions/${name}`),
      {
        data: body,
      },
    );
    if (!response.ok())
      throw new Error(`${name} ${response.status()}: ${await response.text()}`);
    return response.json();
  }
}

/** Saved nodes keyed by node id, with parent, sibling index, attributes and own text. */
export function savedNodeMap(html: string): Map<string, SavedNode> {
  const nodes = new Map<string, SavedNode>();
  type Element = {
    nodeName: string;
    attrs?: { name: string; value: string }[];
    childNodes?: Element[];
    value?: string;
  };
  const visit = (element: Element, parent: string | null) => {
    let index = 0;
    for (const child of element.childNodes ?? []) {
      if (!child.attrs) continue;
      const attrs = Object.fromEntries(
        child.attrs.map((attr) => [attr.name, attr.value]),
      );
      const id = attrs[NODE_ID];
      if (id) {
        const text = (child.childNodes ?? [])
          .filter((grandchild) => grandchild.nodeName === "#text")
          .map((grandchild) => grandchild.value ?? "")
          .join("")
          .trim();
        nodes.set(id, { id, tag: child.nodeName, parent, index, attrs, text });
      }
      index += 1;
      visit(child, id ?? parent);
    }
  };
  visit(parse(html) as unknown as Element, null);
  return nodes;
}

/**
 * Fails if any saved node other than `changed` gained, lost or changed its tag, parent, attributes or text.
 * Sibling index is ignored here: moving one node legitimately shifts its old and new siblings.
 */
export function expectOnlyChanged(
  before: Map<string, SavedNode>,
  after: Map<string, SavedNode>,
  changed: string[],
) {
  const touched = new Set(changed);
  const drift: string[] = [];
  const comparable = ({ index: _index, ...rest }: SavedNode) =>
    JSON.stringify(rest);
  for (const [id, node] of before) {
    if (touched.has(id)) continue;
    const now = after.get(id);
    if (!now) drift.push(`${id} vanished`);
    else if (comparable(now) !== comparable(node)) drift.push(`${id} changed`);
  }
  for (const id of after.keys())
    if (!before.has(id) && !touched.has(id)) drift.push(`${id} appeared`);
  expect(drift, "nodes other than the edited ones changed").toEqual([]);
}

export function childrenOf(nodes: Map<string, SavedNode>, parent: string) {
  return [...nodes.values()]
    .filter((node) => node.parent === parent)
    .sort((a, b) => a.index - b.index)
    .map((node) => node.id);
}

export function styleOf(node: SavedNode | undefined) {
  const style: Record<string, string> = {};
  for (const declaration of (node?.attrs.style ?? "").split(";")) {
    const [property, ...value] = declaration.split(":");
    if (property?.trim()) style[property.trim()] = value.join(":").trim();
  }
  return style;
}

export const test = base.extend<{ app: App }>({
  app: [
    async ({ page }, use, testInfo) => {
      const app = new App(page);
      await app.attach();
      await use(app);
      await app.teardown(testInfo);
    },
    { auto: true },
  ],
});

export { expect };
