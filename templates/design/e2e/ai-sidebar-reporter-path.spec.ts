import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { appPath, cdpScreenshot, designFrame, selectByText } from "./helpers";

const GENERATION_PROMPT =
  "Build a Luna Orbit project overview with a responsive desktop and mobile layout.";
const FOLLOW_UP =
  "The selected mobile heading needs a stronger visual hierarchy. Make the selected mobile heading larger.";


test.use({ viewport: { width: 2800, height: 1200 } });

type DesignFile = { id: string; filename: string; content: string };
type DesignRecord = {
  files?: DesignFile[];
  data?: string | { canvasFrames?: Record<string, { width?: number }> };
};

async function readDesign(page: import("@playwright/test").Page, id: string) {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${encodeURIComponent(id)}`),
  );
  if (!response.ok())
    throw new Error(`get-design failed: ${await response.text()}`);
  return (await response.json()) as DesignRecord;
}

async function fitCanvasEvidence(
  page: import("@playwright/test").Page,
  zoomOut = true,
) {
  await page.keyboard.press("Shift+1");
  if (zoomOut) await page.keyboard.press("-");
  await page.waitForTimeout(600);
}

test("PromptPopover runs deterministic Luna-sidebar transport and same-thread mobile edit", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_AI_SIDEBAR_LOOPBACK !== "1",
    "requires E2E_AI_SIDEBAR_LOOPBACK=1",
  );
  await page.context().addInitScript(() => {
    const selection = JSON.stringify({
      model: "agentkit-loopback",
      engine: "ai-sdk:openai",
      effort: "medium",
    });
    localStorage.setItem(
      "agent-native:chat-models:selection:design",
      selection,
    );
    localStorage.setItem("agent-native:chat-models:selection", selection);
  });

  await page.goto(appPath("/"), { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "New Design", exact: true }).click();
  const prompt = page.locator(
    "[data-agent-native-prompt-popover] .ProseMirror",
  );
  await expect(prompt).toBeVisible();
  const startWithAi = page.locator("[data-start-with-ai]");
  if (await startWithAi.isVisible().catch(() => false))
    await startWithAi.click();
  await prompt.fill(GENERATION_PROMPT);
  await prompt.press("Enter");

  await expect(page).toHaveURL(/\/design\/[^/]+/, { timeout: 45_000 });
  const designId = new URL(page.url()).pathname
    .split("/")
    .filter(Boolean)
    .pop();
  if (!designId) throw new Error("design route did not contain an id");
  let generated: DesignRecord = {};
  await expect
    .poll(
      async () => {
        generated = await readDesign(page, designId);
        return (
          generated.files?.some(
            (candidate) => candidate.filename === "index.html",
          ) ?? false
        );
      },
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(true);
  const file = generated.files?.find(
    (candidate) => candidate.filename === "index.html",
  );
  if (!file) throw new Error("Luna generation did not save index.html");
  expect(file.content).toContain("Launch overview");

  const mobileId = `${file.id}::bp-390`;
  await expect(
    page.locator(`iframe[data-screen-iframe-id="${file.id}"]`),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator(`iframe[data-screen-iframe-id="${mobileId}"]`),
  ).toBeVisible({ timeout: 30_000 });
  const heading = designFrame(page, mobileId).locator("h1.title");
  await expect(heading).toBeVisible({ timeout: 30_000 });
  await page
    .locator("[data-breakpoint-frame]")
    .filter({
      has: page.locator(`iframe[data-screen-iframe-id="${mobileId}"]`),
    })
    .locator("[data-frame-label]")
    .click({ force: true });
  await expect
    .poll(() => heading.evaluate((node) => getComputedStyle(node).fontSize))
    .toBe("36px");

  const selection = await selectByText(page, "Launch overview", {
    screenId: mobileId,
  });
  expect(selection.sourceId).toBeTruthy();
  const evidenceDir = path.resolve(
    import.meta.dirname,
    "../../..",
    ".tmp",
    "ai-sidebar-reporter-path",
  );
  await mkdir(evidenceDir, { recursive: true });
  await fitCanvasEvidence(page);
  await cdpScreenshot(page, path.join(evidenceDir, "before-mobile-edit.png"));
  const sidebarPrompt = page
    .locator(".agent-composer-root .ProseMirror")
    .last();
  await expect(sidebarPrompt).toBeVisible({ timeout: 15_000 });
  await sidebarPrompt.fill(FOLLOW_UP);
  await sidebarPrompt.press("Enter");
  await expect
    .poll(() => heading.evaluate((node) => getComputedStyle(node).fontSize), {
      timeout: 45_000,
    })
    .toBe("48px");

  const edited = await readDesign(page, designId);
  const editedFile = edited.files?.find(
    (candidate) => candidate.id === file.id,
  );
  expect(editedFile?.content).toContain("font-size: 48px");
  await expect(designFrame(page, file.id).locator("h1.title")).toHaveCSS(
    "font-size",
    "36px",
  );
  const providerState = await page.request.get(
    `http://127.0.0.1:${test.info().config.metadata.sidebarLoopbackPort}/__state`, // e2e-harness-ignore: separate loopback provider with a dynamic metadata port.
  );
  const state = (await providerState.json()) as {
    callNames: string[];
    modelsSeen: string[];
  };
  expect(state.callNames).toEqual(
    expect.arrayContaining(["generate-design", "edit-design"]),
  );
  expect(
    state.callNames.filter((name) => name === "generate-design").length,
  ).toBeGreaterThan(0);
  expect(state.callNames.filter((name) => name === "edit-design")).toHaveLength(
    1,
  );
  expect(state.modelsSeen).toContain("agentkit-loopback");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(designFrame(page, mobileId).locator("h1.title")).toHaveCSS(
    "font-size",
    "48px",
    { timeout: 30_000 },
  );
  await expect(designFrame(page, file.id).locator("h1.title")).toHaveCSS(
    "font-size",
    "36px",
  );
  await fitCanvasEvidence(page, false);
  await cdpScreenshot(
    page,
    path.join(evidenceDir, "after-reload-mobile-edit.png"),
  );
});
