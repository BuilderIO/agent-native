import { expect, type BrowserContext, type Page } from "@playwright/test";

import { connectToQaBrowser, qaBrowserEndpoint } from "./qa-browser.js";

async function contextIds(): Promise<string[]> {
  const { url: endpoint } = await qaBrowserEndpoint();
  const socket = new WebSocket(endpoint);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener(
        "error",
        () => reject(new Error("QA CDP connection failed")),
        { once: true },
      );
    });
    return await new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("QA context read timed out")),
        5000,
      );
      socket.addEventListener("message", (event) => {
        const message: unknown = JSON.parse(String(event.data));
        if (
          !message ||
          typeof message !== "object" ||
          !("id" in message) ||
          message.id !== 1
        )
          return;
        clearTimeout(timer);
        if (
          !("result" in message) ||
          !message.result ||
          typeof message.result !== "object" ||
          !("browserContextIds" in message.result) ||
          !Array.isArray(message.result.browserContextIds) ||
          !message.result.browserContextIds.every(
            (id: unknown) => typeof id === "string",
          )
        ) {
          reject(new Error("Invalid QA context response"));
          return;
        }
        resolve(message.result.browserContextIds);
      });
      socket.send(
        JSON.stringify({ id: 1, method: "Target.getBrowserContexts" }),
      );
    });
  } finally {
    socket.close();
  }
}

async function targetInfo(context: BrowserContext, page: Page) {
  const session = await context.newCDPSession(page);
  try {
    const { targetInfo } = await session.send("Target.getTargetInfo");
    if (!targetInfo.browserContextId)
      throw new Error("Owned target has no context ID");
    return {
      targetId: targetInfo.targetId,
      contextId: targetInfo.browserContextId,
    };
  } finally {
    await session.detach();
  }
}

async function exercise(context: BrowserContext, page: Page) {
  await context.route("**/*", async (route) => {
    const hostname = new URL(route.request().url()).hostname;
    if (hostname === "qa-parent.invalid")
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: '<iframe title="owned-frame" src="https://qa-frame.invalid/"></iframe>',
      });
    else if (hostname === "qa-frame.invalid")
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<button>Frame control</button>",
      });
    else await route.abort();
  });
  await page.goto("https://qa-parent.invalid/");
  await page
    .frameLocator('iframe[title="owned-frame"]')
    .getByRole("button", { name: "Frame control" })
    .click();
  const popupPromise = page.waitForEvent("popup");
  await page.evaluate(() => window.open("about:blank"));
  const popup = await popupPromise;
  await popup.setContent("<button>Popup control</button>");
  await popup.getByRole("button", { name: "Popup control" }).click();
  await popup.close();
}

const first = await connectToQaBrowser();
const second = await connectToQaBrowser();
const firstContext = await first.newContext();
const secondContext = await second.newContext();
let ids: string[] = [];
try {
  const [firstPage, secondPage] = await Promise.all([
    firstContext.newPage(),
    secondContext.newPage(),
  ]);
  const [firstTarget, secondTarget] = await Promise.all([
    targetInfo(firstContext, firstPage),
    targetInfo(secondContext, secondPage),
  ]);
  ids = [firstTarget.contextId, secondTarget.contextId];
  expect(new Set(ids).size).toBe(2);
  const secondRoot = await second.newBrowserCDPSession();
  try {
    await expect(
      secondRoot.send("Target.attachToTarget", {
        targetId: firstTarget.targetId,
        flatten: true,
      }),
    ).rejects.toThrow("not owned");
    await expect(
      secondRoot.send("Target.createTarget", { url: "about:blank" }),
    ).rejects.toThrow("not owned");
    await expect(secondRoot.send("Browser.close")).rejects.toThrow("disabled");
    await expect(
      secondRoot.send("Target.activateTarget", {
        targetId: firstTarget.targetId,
      }),
    ).rejects.toThrow("disabled");
  } finally {
    await secondRoot.detach();
  }
  const firstSession = await firstContext.newCDPSession(firstPage);
  try {
    await expect(firstSession.send("Page.bringToFront")).rejects.toThrow(
      "disabled",
    );
  } finally {
    await firstSession.detach();
  }
  await Promise.all([
    exercise(firstContext, firstPage),
    exercise(secondContext, secondPage),
  ]);
  const dialogPromise = firstPage.waitForEvent("dialog", { timeout: 30000 });
  const confirmation = firstPage
    .evaluate(() => confirm("Owned dialog test"))
    .then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
  const dialog = await dialogPromise;
  const observer = await connectToQaBrowser();
  try {
    await dialog.accept();
    const result = await confirmation;
    if ("error" in result)
      throw result.error instanceof Error
        ? result.error
        : new Error("Dialog evaluation failed");
    expect(result.value).toBe(true);
  } finally {
    await observer.close();
  }
  expect(await secondPage.evaluate(() => document.location.hostname)).toBe(
    "qa-parent.invalid",
  );
  console.log(
    "PASS scoped clients: foreign control denied; owned pages, frames, popups and dialog work",
  );
} finally {
  await Promise.all([firstContext.close(), secondContext.close()]);
  await Promise.all([first.close(), second.close()]);
}
const remaining = await contextIds();
for (const id of ids) expect(remaining).not.toContain(id);
console.log("PASS owned contexts closed in QA browser");
