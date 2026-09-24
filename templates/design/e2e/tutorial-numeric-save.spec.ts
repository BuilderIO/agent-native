import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { appPath, designFrame, gotoEditor, selectByText } from "./helpers";

const TARGET_ID = "tutorial-numeric-save-target";

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    appPath(`/_agent-native/actions/${name}`),
    {
      data: input,
    },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function getDesignSource(page: Page, designId: string): Promise<string> {
  const response = await page.request.get(
    appPath(
      `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    ),
  );
  if (!response.ok()) throw new Error(`get-design: ${await response.text()}`);
  const design = await response.json();
  const file = design.files?.find(
    (candidate: { filename?: string }) => candidate.filename === "screen.html",
  );
  if (typeof file?.content !== "string") {
    throw new Error("screen.html source is missing from get-design");
  }
  return file.content;
}

async function readPersistedStyles(page: Page, designId: string) {
  const source = await getDesignSource(page, designId);
  const styles = await page.evaluate(
    ({ html, targetId }) => {
      const document = new DOMParser().parseFromString(html, "text/html");
      const node = document.querySelector<HTMLElement>(
        `[data-agent-native-node-id="${targetId}"]`,
      );
      if (!node) throw new Error("target node is missing from saved source");
      return {
        width: node.style.width,
        height: node.style.height,
        left: node.style.left,
        top: node.style.top,
      };
    },
    { html: source, targetId: TARGET_ID },
  );
  return { source, styles };
}

async function createSingleFrameDesign(page: Page): Promise<string> {
  const created = await action(page.request, "create-design", {
    title: `Numeric inspector save ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id;
  if (typeof designId !== "string") throw new Error("missing design id");

  const file = await action(page.request, "create-file", {
    designId,
    filename: "screen.html",
    fileType: "html",
    content: `<!doctype html><html><head></head><body style="margin:0;min-height:100vh;background:#fff"><div data-agent-native-node-id="${TARGET_ID}" data-agent-native-layer-name="Numeric save target" style="position:absolute;left:10px;top:12px;width:120px;height:80px;background:#2563eb">Numeric save target</div></body></html>`,
  });
  const fileId = file.id ?? file.data?.id;
  if (typeof fileId !== "string") throw new Error("missing screen id");

  await action(page.request, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: 100, y: 100, width: 480, height: 320 },
      },
    ],
  });

  return designId;
}

async function readTargetStyle(page: Page) {
  return designFrame(page)
    .locator(`[data-agent-native-node-id="${TARGET_ID}"]`)
    .evaluate((node) => {
      const style = (node as HTMLElement).style;
      return {
        width: style.width,
        height: style.height,
        left: style.left,
        top: style.top,
      };
    });
}

async function saveToasts(page: Page): Promise<string[]> {
  return (
    await page.locator("[data-sonner-toast], [role='alert']").allTextContents()
  )
    .map((text) => text.trim())
    .filter(Boolean);
}

test("rapid W/H/X/Y inspector Enter edits persist without a save conflict", async ({
  page,
}, testInfo) => {
  const designId = await createSingleFrameDesign(page);
  try {
    await gotoEditor(page, designId);
    await expect(page.locator("[data-screen-shell]")).toHaveCount(1);
    await selectByText(page, "Numeric save target");

    const edits = [
      ["W size in pixels", "137"],
      ["H size in pixels", "93"],
      ["X-position", "37"],
      ["Y-position", "51"],
    ] as const;

    for (const [label, value] of edits) {
      const input = page.locator(`input[aria-label="${label}"]`);
      await expect(input).toBeVisible();
      await input.fill(value);
      await input.press("Enter");
    }

    const burstToasts = await saveToasts(page);
    const expectedStyle = {
      width: "137px",
      height: "93px",
      left: "37px",
      top: "51px",
    };
    let sourceBeforeReload = "";
    let stylesBeforeReload = {} as typeof expectedStyle;
    const pollStartedAt = Date.now();
    do {
      const saved = await readPersistedStyles(page, designId);
      sourceBeforeReload = saved.source;
      stylesBeforeReload = saved.styles;
      if (
        Object.entries(expectedStyle).every(
          ([key, value]) =>
            stylesBeforeReload[key as keyof typeof expectedStyle] === value,
        )
      ) {
        break;
      }
      await page.waitForTimeout(250);
    } while (Date.now() - pollStartedAt < 10_000);

    const settledToasts = await saveToasts(page);
    await testInfo.attach("rapid-edit-save-evidence.json", {
      body: JSON.stringify(
        {
          immediateToasts: burstToasts,
          settledToasts,
          stylesBeforeReload,
          sourceBeforeReload,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible();
    await expect(
      designFrame(page).locator(`[data-agent-native-node-id="${TARGET_ID}"]`),
    ).toBeAttached();

    const persisted = await readPersistedStyles(page, designId);
    const persistedStyle = await readTargetStyle(page);
    await testInfo.attach("persisted-source-style.json", {
      body: JSON.stringify(
        {
          styleInSavedSource: persisted.styles,
          styleAfterReloadInEditor: persistedStyle,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });

    expect([...burstToasts, ...settledToasts].join("\n")).not.toMatch(
      /This screen changed elsewhere\. Your last edit was not saved\./,
    );
    expect(stylesBeforeReload).toEqual(expectedStyle);
    expect(persisted.styles).toEqual(expectedStyle);
    expect(persistedStyle).toEqual({
      width: "137px",
      height: "93px",
      left: "37px",
      top: "51px",
    });
  } finally {
    await action(page.request, "delete-design", { id: designId });
  }
});

test("numeric inspector matches unary and exponent precedence", async ({
  page,
}) => {
  const designId = await createSingleFrameDesign(page);
  try {
    await gotoEditor(page, designId);
    await selectByText(page, "Numeric save target");
    const input = page.getByRole("textbox", {
      name: "X-position",
      exact: true,
    });
    for (const [expression, expected] of [
      ["-2^2", "-4"],
      ["-(2+3)", "-5"],
      ["2^-2", "-5"],
      ["2^(-2)", "0.25"],
    ] as const) {
      await input.fill(expression);
      await input.press("Enter");
      await expect(input).toHaveValue(`${expected}px`);
      await expect
        .poll(async () => (await readTargetStyle(page)).left)
        .toBe(`${expected}px`);
    }
    const yInput = page.getByRole("textbox", {
      name: "Y-position",
      exact: true,
    });
    await yInput.fill("0.75");
    await yInput.press("Enter");
    await expect(yInput).toHaveValue("0.75px");
    await expect
      .poll(async () => (await readPersistedStyles(page, designId)).styles.left)
      .toBe("0.25px");
    await expect
      .poll(async () => (await readPersistedStyles(page, designId)).styles.top)
      .toBe("0.75px");
    await page.reload({ waitUntil: "domcontentloaded" });
    await selectByText(page, "Numeric save target");
    await expect(input).toHaveValue("0.25px");
    await expect(yInput).toHaveValue("0.75px");
    expect((await readTargetStyle(page)).left).toBe("0.25px");
  } finally {
    await action(page.request, "delete-design", { id: designId });
  }
});
