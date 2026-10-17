import { test, expect, type Page, type APIResponse } from "@playwright/test";

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

async function getDocContent(page: Page, id: string): Promise<string> {
  const res = await page.request.get(
    `${GET_ACTION}?id=${encodeURIComponent(id)}`,
    { headers: { "X-Agent-Native-Frontend": "1" } },
  );
  expect(res.ok(), `get-document ok (status ${res.status()})`).toBeTruthy();
  const body = await readJson(res);
  return typeof body.content === "string" ? body.content : "";
}

function prose(page: Page) {
  return page.locator(".notion-editor.ProseMirror").first();
}

function blockNode(page: Page, blockId: string) {
  return page.locator(`.plan-block-node[data-block-id="${blockId}"]`).first();
}

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
  test("api-endpoint (<Endpoint>) renders the GET pill + path, survives reload AND dark mode", async ({
    page,
  }) => {
    const blockId = "e-render-1";
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

    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err?.message ?? err)));

    const id = await createDocFixture(page, {
      title: uniqueTitle("api-endpoint"),
      content: nfm,
    });

    expect(
      (await getDocContent(page, id)).includes(`<Endpoint id="${blockId}"`),
      "the <Endpoint> block should persist in the stored NFM",
    ).toBeTruthy();

    await openDoc(page, id);

    const node = blockNode(page, blockId);
    await expect(
      node,
      `the registryBlock NodeView for "${blockId}" should mount in the content editor`,
    ).toBeVisible({ timeout: 30_000 });

    await expect(node).toContainText("GET", {
      timeout: BLOCK_RENDER_TIMEOUT,
    });
    await expect(node).toContainText(path);

    expect(
      pageErrors,
      `no uncaught page errors while rendering the api-endpoint block: ${pageErrors.join(" | ")}`,
    ).toEqual([]);

    await page.reload();
    await openDocAfterReload(page, id, blockId);
    await expect(blockNode(page, blockId)).toContainText("GET", {
      timeout: BLOCK_RENDER_TIMEOUT,
    });
    await expect(blockNode(page, blockId)).toContainText(path);

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

    await expect
      .poll(
        async () => (await getDocContent(page, id)).includes(`id="${blockId}"`),
        {
          timeout: 15_000,
        },
      )
      .toBeTruthy();
  });

  test("diff (<Diff>) renders the filename + an added-only token and survives reload", async ({
    page,
  }) => {
    const blockId = "d-render-1";
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

async function openDocAfterReload(page: Page, _id: string, blockId: string) {
  const editor = prose(page);
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await expect(blockNode(page, blockId)).toBeVisible({ timeout: 30_000 });
}
