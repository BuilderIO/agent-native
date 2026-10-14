import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Response,
} from "@playwright/test";

import { DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES } from "../shared/design-token-import-limits";
import { e2eBaseURL } from "./base-url";
import { FIXTURE_HTML } from "./global-setup";
import { gotoEditor } from "./helpers";

let designId: string;
let baseURLForActions: string;

async function postAction(
  request: APIRequestContext,
  actionName: string,
  input: Record<string, unknown>,
): Promise<any> {
  const response = await request.post(
    `${baseURLForActions}/_agent-native/actions/${actionName}`,
    {
      data: input,
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!response.ok()) {
    throw new Error(
      `${actionName} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function waitForAction(
  page: Page,
  actionName: string,
  trigger: () => Promise<void>,
): Promise<Response> {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/_agent-native/actions/${actionName}`) &&
      response.request().method() !== "OPTIONS",
    { timeout: 20_000 },
  );
  await trigger();
  const response = await responsePromise;
  expect(
    response.ok(),
    `${actionName} failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);
  return response;
}

test.beforeAll(async ({ request }, workerInfo) => {
  baseURLForActions =
    (workerInfo.project.use.baseURL as string | undefined) ?? e2eBaseURL();

  const created = await postAction(request, "create-design", {
    title: "E2E Token File Import",
    projectType: "prototype",
  });
  designId = created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) {
    throw new Error(
      `create-design did not return an id: ${JSON.stringify(created)}`,
    );
  }

  await postAction(request, "create-file", {
    designId,
    filename: "index.html",
    content: FIXTURE_HTML,
    fileType: "html",
  });
});

test.afterAll(async ({ request }) => {
  if (!designId) return;
  await postAction(request, "delete-design", { id: designId }).catch(() => {});
});

test.beforeEach(async ({ page }) => {
  await gotoEditor(page, designId);
});

test("token file import continues after an oversized selection", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Tokens", exact: true }).click();
  await page
    .getByRole("button", { name: "Import tokens", exact: true })
    .click();
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Import from a file/ }).click();
  const fileChooser = await fileChooserPromise;

  const response = await waitForAction(page, "import-design-tokens", () =>
    fileChooser.setFiles([
      {
        name: "too-large.css",
        mimeType: "text/css",
        buffer: Buffer.alloc(DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES + 1, " "),
      },
      {
        name: "tokens.css",
        mimeType: "text/css",
        buffer: Buffer.from(":root { --color-upload: #aabbcc; }"),
      },
    ]),
  );

  expect(response.request().postDataJSON()).toMatchObject({
    source: "files",
    files: [
      {
        filename: "tokens.css",
        content: ":root { --color-upload: #aabbcc; }",
      },
    ],
  });
  await expect(page.getByRole("status")).toContainText("Imported 1 tokens.");
  await expect(page.getByRole("status")).toContainText("files: 1");
});
