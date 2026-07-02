import path from "node:path";

import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  appPath,
  bridgeMessages,
  designFrame,
  installBridge,
  readSeedDesignId,
} from "./helpers";

const AUTH_STATE_PATH = path.join(import.meta.dirname, ".auth", "state.json");
const BASE_URL =
  process.env.E2E_BASE_URL ??
  `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 9333)}`;
const SHORTCUT = process.platform === "darwin" ? "Meta+k" : "Control+k";

let designId: string;

type PageRuntimeErrors = {
  consoleErrors: string[];
  pageErrors: string[];
};

type SignedOutPage = PageRuntimeErrors & {
  page: Page;
  close: () => Promise<void>;
  mutationRequests: string[];
};

test.describe.serial("public visual edit", () => {
  test.beforeAll(async ({ browser }) => {
    designId = await readSeedDesignId();
    await setDesignVisibility(browser, designId, "public");
  });

  test.afterAll(async ({ browser }) => {
    if (!designId) return;
    await setDesignVisibility(browser, designId, "private");
  });

  test("loads the public /visual-edit route without a session and stays crash-free", async ({
    browser,
  }) => {
    const signedOut = await openSignedOutPage(browser, "/visual-edit");
    try {
      await expect(signedOut.page).toHaveURL(
        new RegExp(`${escapeRegExp(appUrl("/visual-edit"))}(?:[?#].*)?$`),
      );
      await expect(
        signedOut.page.getByRole("heading", { level: 1 }).first(),
      ).toBeVisible();
      await expect(
        signedOut.page
          .getByRole("link", {
            name: /sign up free to save/i,
          })
          .first(),
      ).toBeVisible();
      await assertNoRuntimeErrors(signedOut);

      await signedOut.page.keyboard.press(SHORTCUT);
      await expect(
        signedOut.page.locator('[role="dialog"]:visible'),
      ).toHaveCount(0);
      await assertNoRuntimeErrors(signedOut);
    } finally {
      await signedOut.close();
    }
  });

  test("signed-out /visual-edit save CTA sends visitors to the sign-in return URL", async ({
    browser,
  }) => {
    await expectReturnUrl(
      browser,
      "/visual-edit",
      (page) =>
        page.getByRole("link", { name: /sign up free to save/i }).first(),
      "/visual-edit?intent=save",
    );
  });

  test("public /design/:id renders read-only and stays crash-free", async ({
    browser,
  }) => {
    const signedOut = await openSignedOutPage(browser, `/design/${designId}`);
    try {
      await expect(
        designFrame(signedOut.page).getByText("E2E Hero Heading"),
      ).toBeVisible();
      await expect(
        signedOut.page
          .getByRole("button")
          .filter({ hasText: /sign up free to save/i })
          .first(),
      ).toBeVisible();
      await expect(
        signedOut.page.getByRole("button", { name: /^share$/i }).first(),
      ).toBeVisible();

      signedOut.mutationRequests.length = 0;
      await installBridge(signedOut.page);
      await signedOut.page.evaluate(() => {
        (window as any).__bridge = [];
      });
      const heading = designFrame(signedOut.page)
        .getByText("E2E Hero Heading")
        .first();
      const headingBox = await heading.boundingBox();
      expect(headingBox).toBeTruthy();
      await signedOut.page.mouse.click(
        (headingBox?.x ?? 0) + (headingBox?.width ?? 0) / 2,
        (headingBox?.y ?? 0) + (headingBox?.height ?? 0) / 2,
      );
      await signedOut.page.keyboard.type("read-only check");
      await signedOut.page.waitForTimeout(400);

      expect(signedOut.mutationRequests).toEqual([]);
      await expect
        .poll(async () =>
          (await bridgeMessages(signedOut.page)).some((message) =>
            /^(visual-style-change|visual-structure-change|visual-duplicate-change|text-content-change)$/.test(
              String(message?.type ?? ""),
            ),
          ),
        )
        .toBe(false);
      await expect(
        designFrame(signedOut.page).getByText("E2E Hero Heading"),
      ).toBeVisible();

      await signedOut.page.keyboard.press(SHORTCUT);
      await expect(
        signedOut.page.locator('[role="dialog"]:visible'),
      ).toHaveCount(0);
      await assertNoRuntimeErrors(signedOut);
    } finally {
      await signedOut.close();
    }
  });

  test("signed-out save and share buttons send visitors to the sign-in return URL", async ({
    browser,
  }) => {
    await expectReturnUrl(
      browser,
      `/design/${designId}`,
      (page) =>
        page
          .getByRole("button")
          .filter({ hasText: /sign up free to save/i })
          .first(),
      appReturnPath(`/design/${designId}?intent=save`),
    );

    await expectReturnUrl(
      browser,
      `/design/${designId}`,
      (page) => page.getByRole("button", { name: /^share$/i }).first(),
      appReturnPath(`/design/${designId}?intent=share`),
    );
  });
});

async function setDesignVisibility(
  browser: Browser,
  id: string,
  visibility: "public" | "private",
): Promise<void> {
  const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
  try {
    const response = await context.request.post(
      `${BASE_URL}/_agent-native/actions/set-resource-visibility`,
      {
        data: {
          resourceType: "design",
          resourceId: id,
          visibility,
        },
      },
    );
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as {
      visibility?: string;
      ok?: boolean;
    };
    expect(body.visibility ?? visibility).toBe(visibility);
  } finally {
    await context.close();
  }
}

async function openSignedOutPage(
  browser: Browser,
  pathname: string,
): Promise<SignedOutPage> {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const mutationRequests: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("request", (request) => {
    const url = request.url();
    if (request.method() === "POST" && /\/_agent-native\/actions\//.test(url)) {
      mutationRequests.push(url);
    }
  });

  await page.goto(appUrl(pathname), {
    waitUntil: "domcontentloaded",
  });

  return {
    page,
    consoleErrors,
    pageErrors,
    mutationRequests,
    close: async () => {
      await context.close();
    },
  };
}

async function expectReturnUrl(
  browser: Browser,
  pathname: string,
  getButton: (page: Page) => Locator,
  expectedReturnPath: string,
): Promise<void> {
  const signedOut = await openSignedOutPage(browser, pathname);
  try {
    const button = getButton(signedOut.page);
    await expect(button).toBeVisible();
    await button.click();
    await expect(signedOut.page).toHaveURL(/\/_agent-native\/sign-in\?return=/);

    const url = new URL(signedOut.page.url());
    const returned = url.searchParams.get("return");
    expect(returned).toBeTruthy();
    const decoded = decodeURIComponent(returned ?? "");
    expect(decoded).toBe(expectedReturnPath);
    await assertNoRuntimeErrors(signedOut);
  } finally {
    await signedOut.close();
  }
}

async function assertNoRuntimeErrors({
  consoleErrors,
  pageErrors,
}: PageRuntimeErrors): Promise<void> {
  const unexpectedConsoleErrors = consoleErrors.filter(
    (message) => !message.includes("401 (Unauthorized)"),
  );
  expect(
    unexpectedConsoleErrors,
    `console errors: ${unexpectedConsoleErrors.join("\n")}`,
  ).toEqual([]);
  expect(pageErrors, `page errors: ${pageErrors.join("\n")}`).toEqual([]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function appUrl(pathname: string): string {
  return new URL(appPath(pathname), BASE_URL).toString();
}

function appReturnPath(pathname: string): string {
  const url = new URL(appUrl(pathname));
  return `${url.pathname}${url.search}${url.hash}`;
}
