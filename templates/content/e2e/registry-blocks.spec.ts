import { test, expect, type Page, type APIResponse } from "@playwright/test";

/*
 * REGISTRY BLOCKS — live render E2E for the editor-unification claim.
 *
 * Area under test: the content app's `VisualEditor` consumes core's
 * `RegistryBlockNode` (`createRegistryBlockNode`) -> `RegistryBlockNodeView` ->
 * `BlockView` -> each block's React `Read` component — the SAME render path the
 * plan app's `dev-doc-blocks.spec.ts` already browser-proved 8/8.
 *
 * Content stores a document as a single Notion-Flavored-Markdown (NFM) string in
 * `documents.content`. A registry block (mermaid, api-endpoint / `<Endpoint>`,
 * data-model, diff / `<Diff>`, file-tree, json-explorer, annotated-code,
 * openapi-spec) is encoded INLINE as a PascalCase MDX element. On open, `nfm.ts`
 * parses the element into a `registryBlock` ProseMirror atom (preserving the
 * verbatim source as `__raw`); the editor lazily hydrates its typed `data` and
 * the shared NodeView mounts a `.plan-block-node[data-block-id=<id>]` wrapping a
 * `section.plan-block` rendered by the block's `Read`.
 *
 * The NFM round-trip (data) is already proven by content's unit tests
 * (`shared/nfm.registry.spec.ts`, `app/components/editor/*roundtrip*`). What was
 * NOT yet confirmed — and what this spec confirms in a real browser — is that
 * content's editor VISUALLY mounts + renders the NodeView for an inline registry
 * block.
 *
 * Each test:
 *   1. Creates a document whose NFM body carries a recognizable registry block,
 *      via the authed action surface (`create-document`).
 *   2. Opens `/page/<id>` and waits for the editor surface (`.ProseMirror`).
 *   3. Asserts the block's NodeView (`.plan-block-node[data-block-id=<id>]`)
 *      mounts and renders the block's distinctive content (api-endpoint -> the
 *      "GET" method pill + path; diff -> the filename + an added-only token).
 *   4. Asserts the render survives a full page reload, and (for one block) that
 *      it still renders in dark mode without throwing.
 *
 * The block ids in the fixtures are the `id="…"` attribute of the MDX element —
 * the editor's `registryBlock` node carries that exact id as `data-block-id`.
 * retries:2 + web-first auto-retrying expects absorb transient HMR reloads.
 */

const CREATE_ACTION = "/_agent-native/actions/create-document";
const GET_ACTION = "/_agent-native/actions/get-document";
const BLOCK_RENDER_TIMEOUT = 45_000;

async function readJson(res: APIResponse): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function uniqueTitle(label: string): string {
  return `Registry ${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * Create a document fixture through the authed action surface and return its id.
 * The shared dev server can HMR/reload mid-request (a transient 500), so retry a
 * few times — a fixture hiccup must never read as the render bug under test.
 */
async function createDocFixture(
  page: Page,
  opts: { title: string; content: string },
): Promise<string> {
  let res: APIResponse | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    res = await page.request.post(CREATE_ACTION, {
      data: { title: opts.title, content: opts.content },
      headers: { "X-Agent-Native-Frontend": "1" },
    });
    if (res.ok()) break;
    await page.waitForTimeout(800);
  }
  expect(
    res?.ok(),
    `create-document should succeed (status ${res?.status()}): ${await (
      res as APIResponse
    )
      .text()
      .catch(() => "")}`,
  ).toBeTruthy();
  const body = await readJson(res as APIResponse);
  const id = body.id as string | undefined;
  expect(
    id,
    `create-document returns a document id: ${JSON.stringify(body).slice(0, 300)}`,
  ).toBeTruthy();
  return id as string;
}

/** Read the document's persisted NFM content (for the "no wipe" assertion). */
async function getDocContent(page: Page, id: string): Promise<string> {
  const res = await page.request.get(
    `${GET_ACTION}?id=${encodeURIComponent(id)}`,
    { headers: { "X-Agent-Native-Frontend": "1" } },
  );
  expect(res.ok(), `get-document ok (status ${res.status()})`).toBeTruthy();
  const body = await readJson(res);
  return typeof body.content === "string" ? body.content : "";
}

/** The editable ProseMirror editor surface for the open document. */
function prose(page: Page) {
  return page.locator(".notion-editor.ProseMirror").first();
}

/** The shared registry-block NodeView wrapper for a given block id. */
function blockNode(page: Page, blockId: string) {
  return page.locator(`.plan-block-node[data-block-id="${blockId}"]`).first();
}

/** Open the document and wait for the editor surface to be ready + editable. */
async function openDoc(page: Page, id: string) {
  await page.goto(`/page/${id}`);
  const editor = prose(page);
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await expect(editor).toHaveAttribute("contenteditable", "true", {
    timeout: 20_000,
  });
  return editor;
}

test.describe("content editor renders inline registry blocks", () => {
  // api-endpoint -> `<Endpoint>` -> ApiEndpointRead: the colored method pill
  // ("GET") + the monospace path. Authored as valid inline NFM (the exact shape
  // content's serializer round-trips — see shared/nfm.registry.spec.ts).
  test("api-endpoint (<Endpoint>) renders the GET pill + path, survives reload AND dark mode", async ({
    page,
  }) => {
    const blockId = "e-render-1";
    // Canonical NFM verified to round-trip byte-exact and parse to a single
    // `api-endpoint` registryBlock (see shared/nfm.registry.spec.ts shapes; the
    // children form `>…</Endpoint>` is what content's serializer emits when a
    // `summary` attr is present). A brace-free path keeps it a plain string attr.
    const path = "/api/users/by-id";
    const nfm = [
      "# API reference",
      "Some intro prose above the endpoint.",
      `<Endpoint id="${blockId}" method="GET" path="${path}" summary="Fetch a single user">`,
      "",
      "",
      "",
      "</Endpoint>",
      "Outro prose below the endpoint.",
    ].join("\n");

    // Surface any uncaught page error so a render crash is reported clearly
    // (and is never masked by a passing visibility assertion).
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err?.message ?? err)));

    const id = await createDocFixture(page, {
      title: uniqueTitle("api-endpoint"),
      content: nfm,
    });

    // Sanity: the inline registry block persisted in the stored NFM.
    expect(
      (await getDocContent(page, id)).includes(`<Endpoint id="${blockId}"`),
      "the <Endpoint> block should persist in the stored NFM",
    ).toBeTruthy();

    await openDoc(page, id);

    // The shared NodeView mounts for THIS block id...
    const node = blockNode(page, blockId);
    await expect(
      node,
      `the registryBlock NodeView for "${blockId}" should mount in the content editor`,
    ).toBeVisible({ timeout: 30_000 });

    // ...and ApiEndpointRead renders the collapsed row: the "GET" method pill +
    // the verbatim path. This is the load-bearing proof that BlockView -> the
    // React Read component actually ran in the browser, not just round-tripped.
    await expect(node).toContainText("GET", {
      timeout: BLOCK_RENDER_TIMEOUT,
    });
    await expect(node).toContainText(path);

    expect(
      pageErrors,
      `no uncaught page errors while rendering the api-endpoint block: ${pageErrors.join(" | ")}`,
    ).toEqual([]);

    // Survives a full reload (re-parse from the stored NFM, re-mount the NodeView).
    await page.reload();
    await openDocAfterReload(page, id, blockId);
    await expect(blockNode(page, blockId)).toContainText("GET", {
      timeout: BLOCK_RENDER_TIMEOUT,
    });
    await expect(blockNode(page, blockId)).toContainText(path);

    // Dark mode: next-themes toggles `.dark` on <html>; the block must still
    // render its content without throwing.
    await page.evaluate(() => {
      const root = document.documentElement;
      root.classList.remove("light");
      root.classList.add("dark");
      try {
        window.localStorage.setItem("theme", "dark");
      } catch {
        /* ignore */
      }
    });
    await expect(blockNode(page, blockId)).toBeVisible({
      timeout: BLOCK_RENDER_TIMEOUT,
    });
    await expect(blockNode(page, blockId)).toContainText("GET", {
      timeout: BLOCK_RENDER_TIMEOUT,
    });
    expect(
      pageErrors,
      `no uncaught page errors after reload + dark-mode toggle: ${pageErrors.join(" | ")}`,
    ).toEqual([]);

    // The block is NOT wiped from the stored NFM by opening/reloading.
    await expect
      .poll(
        async () => (await getDocContent(page, id)).includes(`id="${blockId}"`),
        {
          timeout: 15_000,
        },
      )
      .toBeTruthy();
  });

  // diff -> `<Diff>` -> DiffRead: the filename header + a token that exists only
  // on the ADDED side (proves the diff body rendered, not just the chrome).
  test("diff (<Diff>) renders the filename + an added-only token and survives reload", async ({
    page,
  }) => {
    const blockId = "d-render-1";
    // Canonical NFM verified to round-trip byte-exact and parse to a single
    // `diff` registryBlock. `before`/`after` carry real newlines, so content's
    // serializer emits them as JSX-expression attrs (`before={"…\n…"}`) — the
    // `\n` below is a literal backslash-n inside that expression string, exactly
    // what the serializer produces. `a: number` exists ONLY on the added side.
    const nfm =
      `# Change\n` +
      `<Diff id="${blockId}" filename="src/add.ts" language="ts" ` +
      `before={"function add(a, b) {\\n  return a + b;\\n}"} ` +
      `after={"function add(a: number, b: number): number {\\n  return a + b;\\n}"} />`;

    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err?.message ?? err)));

    const id = await createDocFixture(page, {
      title: uniqueTitle("diff"),
      content: nfm,
    });
    expect(
      (await getDocContent(page, id)).includes(`<Diff id="${blockId}"`),
      "the <Diff> block should persist in the stored NFM",
    ).toBeTruthy();

    await openDoc(page, id);

    const node = blockNode(page, blockId);
    await expect(
      node,
      `the registryBlock NodeView for "${blockId}" should mount in the content editor`,
    ).toBeVisible({ timeout: 30_000 });

    // Filename header (always rendered) + a token that ONLY exists on the added
    // side (the typed signature) — proves DiffRead computed and rendered the body.
    await expect(node).toContainText("src/add.ts", {
      timeout: BLOCK_RENDER_TIMEOUT,
    });
    await expect(node).toContainText("a: number");

    expect(
      pageErrors,
      `no uncaught page errors while rendering the diff block: ${pageErrors.join(" | ")}`,
    ).toEqual([]);

    await page.reload();
    await openDocAfterReload(page, id, blockId);
    await expect(blockNode(page, blockId)).toContainText("src/add.ts", {
      timeout: 15_000,
    });
    await expect(blockNode(page, blockId)).toContainText("a: number");
  });
});

/** After a reload, wait for the editor + the block NodeView to re-mount. */
async function openDocAfterReload(page: Page, _id: string, blockId: string) {
  const editor = prose(page);
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await expect(blockNode(page, blockId)).toBeVisible({ timeout: 30_000 });
}
