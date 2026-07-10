import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  createFixtureDesign,
  designFrame,
  gotoEditor,
  selectByText,
} from "./helpers";

const NODE_ID = "e2e-alpha-button";
const PRIMARY = process.platform === "darwin" ? "Meta" : "Control";

type StateValue =
  | "default"
  | "hover"
  | "focus"
  | "focus-visible"
  | "active"
  | "disabled";

const STATE_LABELS: Record<StateValue, string> = {
  default: "Default",
  hover: "Hover",
  focus: "Focus",
  "focus-visible": "Focus visible",
  active: "Pressed",
  disabled: "Disabled",
};

const STATE_OPACITY: Record<Exclude<StateValue, "default">, number> = {
  hover: 0.91,
  focus: 0.82,
  "focus-visible": 0.73,
  active: 0.64,
  disabled: 0.55,
};

let designId = "";

test.describe("element interaction states", () => {
  test.beforeEach(async ({ page }) => {
    designId = await createFixtureDesign(
      page,
      `E2E interaction states ${Date.now()}`,
    );
    await gotoEditor(page, designId);
    await page.getByRole("tab", { name: "Design", exact: true }).click();
    await selectByText(page, "Alpha Button");
    await expect(interactionStateTrigger(page)).toBeVisible();
  });

  test.afterEach(async ({ page }) => {
    if (!designId) return;
    await postAction(page, "delete-design", { id: designId }).catch(() => {});
    designId = "";
  });

  test("authors all six inspector states, preserves selection, and round-trips undo, redo, and reload", async ({
    page,
  }) => {
    const button = alphaButton(page);
    const trigger = interactionStateTrigger(page);

    await expectStateMenuContract(page, "default");
    await setInspectorOpacity(page, 97);
    await expect.poll(() => computedOpacity(button)).toBeCloseTo(0.97, 2);
    await expect.poll(() => inlineOpacity(fileContent(page))).toBe("0.97");

    // Author every non-default state through the actual inspector. Each
    // selection must force-preview immediately, survive the ensuing source
    // write, and keep both the canvas selection and selector stable.
    for (const state of [
      "hover",
      "focus",
      "focus-visible",
      "disabled",
      "active",
    ] as const) {
      await selectInteractionState(page, state);
      await expect(button).toHaveAttribute("data-an-state-preview", state);
      await expect(trigger).toHaveAttribute("data-interaction-state", state);
      await expect(selectedLayerRow(page)).toContainText("Alpha Button");

      // An untouched state inherits Default in the inspector before its first
      // override. This also catches stale values leaking from the prior state.
      await expect(inspectorOpacityInput(page)).toHaveValue("97%");
      await setInspectorOpacity(page, STATE_OPACITY[state] * 100);
      await expect
        .poll(() => computedOpacity(button))
        .toBeCloseTo(STATE_OPACITY[state], 2);
      await expect
        .poll(async () => stateOpacity(await fileContent(page), state))
        .toBe(String(STATE_OPACITY[state]));
      await expect(button).toHaveAttribute("data-an-state-preview", state);
      await expect(trigger).toHaveAttribute("data-interaction-state", state);
      await expect(selectedLayerRow(page)).toContainText("Alpha Button");

      // Re-opening the menu exposes a trailing selection mark even when the
      // currently selected row has only just received its first override.
      await trigger.click();
      const selectedOption = stateOption(page, state);
      await expect(selectedOption).toHaveAttribute("aria-checked", "true");
      await expect(selectedOption.locator("span.rounded-full")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("menu", { name: "Interaction state" }),
      ).toHaveCount(0);
    }

    // Switching back to a previously authored state must show that state's
    // value, not the base value or the most recently visited state's value.
    await selectInteractionState(page, "hover");
    await expect(inspectorOpacityInput(page)).toHaveValue("91%");

    // Geometry changes cause a fresh element-select payload. The interaction
    // selector must remain on Hover instead of flashing/resetting to Default.
    const widthInput = page.locator('input[aria-label="W size in pixels"]');
    await widthInput.fill("220");
    await widthInput.press("Enter");
    await expect(trigger).toHaveAttribute("data-interaction-state", "hover");
    await expect(button).toHaveAttribute("data-an-state-preview", "hover");
    await expect(selectedLayerRow(page)).toContainText("Alpha Button");
    await expect
      .poll(async () =>
        stateProperty(await fileContent(page), "hover", "width"),
      )
      .toBe("220px");

    // Make Pressed the most recent history entry so one undo removes exactly
    // that state override and one redo restores it. DesignEditor deliberately
    // coalesces Yjs content edits inside an 800 ms capture window (slider/scrub
    // gestures become one undo step), so separate these two discrete authored
    // values across that boundary before asserting their history order.
    await page.waitForTimeout(850);
    await selectInteractionState(page, "active");
    await setInspectorOpacity(page, 61);
    await expect
      .poll(async () => stateOpacity(await fileContent(page), "active"))
      .toBe("0.61");

    await pressEditorShortcut(page, "z");
    await expect
      .poll(async () => stateOpacity(await fileContent(page), "active"))
      .toBe("0.64");
    await expect(trigger).toHaveAttribute("data-interaction-state", "active");
    await expect(button).toHaveAttribute("data-an-state-preview", "active");
    await expect.poll(() => computedOpacity(button)).toBeCloseTo(0.64, 2);

    await pressEditorShortcut(page, "z", { shift: true });
    await expect
      .poll(async () => stateOpacity(await fileContent(page), "active"))
      .toBe("0.61");
    await expect(trigger).toHaveAttribute("data-interaction-state", "active");
    await expect(button).toHaveAttribute("data-an-state-preview", "active");
    await expect.poll(() => computedOpacity(button)).toBeCloseTo(0.61, 2);

    // Reload while a forced preview is active. Preview attributes are runtime
    // editor state and must never be baked into or restored from the HTML.
    await gotoEditor(page, designId);
    await expect(alphaButton(page)).not.toHaveAttribute(
      "data-an-state-preview",
      /.+/,
    );
    await selectByText(page, "Alpha Button");
    await expect(interactionStateTrigger(page)).toHaveAttribute(
      "data-interaction-state",
      "default",
    );
    await expect(alphaButton(page)).not.toHaveAttribute(
      "data-an-state-preview",
      /.+/,
    );
    const persistedHtml = await fileContent(page);
    const persistedButtonTag = new RegExp(
      `<button[^>]*data-agent-native-node-id="${NODE_ID}"[^>]*>`,
      "i",
    ).exec(persistedHtml)?.[0];
    expect(persistedButtonTag).toBeTruthy();
    expect(persistedButtonTag).not.toContain("data-an-state-preview=");
  });

  test("persisted pseudo rules obey Chromium mouse, keyboard, pressed, and disabled semantics", async ({
    page,
  }) => {
    const button = alphaButton(page);

    await setInspectorOpacity(page, 97);
    for (const state of [
      "hover",
      "focus",
      "focus-visible",
      "active",
      "disabled",
    ] as const) {
      await selectInteractionState(page, state);
      await setInspectorOpacity(page, STATE_OPACITY[state] * 100);
    }
    await selectInteractionState(page, "default");
    await expect(button).not.toHaveAttribute("data-an-state-preview", /.+/);

    // Real browser state semantics belong to Interact mode. Edit mode
    // intentionally forwards Tab/arrow/delete shortcuts to the Figma-like
    // editor host, while Interact removes that bridge and lets the app receive
    // native pointer and keyboard events.
    const interact = page.getByRole("button", {
      name: "Interact",
      exact: true,
    });
    await interact.click();
    await expect(interact).toHaveAttribute("aria-pressed", "true");
    await expect(button).toBeVisible();

    // The editor's shield intentionally owns canvas selection gestures. Hide
    // only its pointer hit surfaces after authoring so real browser pseudo
    // classes can be exercised directly on the underlying button.
    await designFrame(page)
      .locator("[data-agent-native-edit-overlay]")
      .evaluateAll((nodes) => {
        for (const node of nodes) {
          (node as HTMLElement).style.pointerEvents = "none";
        }
      });
    await button.evaluate((element) => {
      const target = element as HTMLButtonElement & { __clickCount?: number };
      target.__clickCount = 0;
      target.addEventListener("click", () => {
        target.__clickCount = (target.__clickCount ?? 0) + 1;
      });
      target.blur();
    });

    const box = await button.boundingBox();
    if (!box) throw new Error("Alpha Button has no browser bounds");
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    // Mouse hover applies :hover without forcing an editor preview attribute.
    await page.mouse.move(center.x, center.y);
    await expect.poll(() => pseudoMatches(button, ":hover")).toBe(true);
    await expect.poll(() => computedOpacity(button)).toBeCloseTo(0.91, 2);
    await expect(button).not.toHaveAttribute("data-an-state-preview", /.+/);

    // A mouse click produces :focus but not :focus-visible; focus wins over
    // hover according to the managed rule's canonical cascade order.
    await page.mouse.click(center.x, center.y);
    await expect.poll(() => pseudoMatches(button, ":focus")).toBe(true);
    await expect
      .poll(() => pseudoMatches(button, ":focus-visible"))
      .toBe(false);
    await expect.poll(() => computedOpacity(button)).toBeCloseTo(0.82, 2);

    // Keyboard traversal produces both :focus and :focus-visible; the latter
    // is later in the managed cascade and therefore supplies the final value.
    const betaButton = designFrame(page).locator(
      '[data-agent-native-node-id="e2e-beta-button"]',
    );
    // Press through the iframe locator so the key stays in the preview frame.
    // A page-level Shift+Tab can race the bridge's parent-side selection focus
    // after the preceding pointer click and never reach the iframe.
    await betaButton.press("Shift+Tab");
    await expect
      .poll(() =>
        button.evaluate(
          (element) => element.ownerDocument.activeElement === element,
        ),
      )
      .toBe(true);
    await expect.poll(() => pseudoMatches(button, ":focus-visible")).toBe(true);
    await expect.poll(() => computedOpacity(button)).toBeCloseTo(0.73, 2);

    // Pointer-down is the real :active/Pressed state. Assert while the button
    // is held, then release and ensure the click completes normally.
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await expect.poll(() => pseudoMatches(button, ":active")).toBe(true);
    await expect.poll(() => computedOpacity(button)).toBeCloseTo(0.64, 2);
    await page.mouse.up();
    await expect.poll(() => pseudoMatches(button, ":active")).toBe(false);
    await expect.poll(() => clickCount(button)).toBe(2);

    // :disabled requires the native disabled attribute. Chromium must apply
    // its style while suppressing pointer activation.
    await button.evaluate((element) => {
      (element as HTMLButtonElement).disabled = true;
    });
    await expect.poll(() => pseudoMatches(button, ":disabled")).toBe(true);
    await expect.poll(() => computedOpacity(button)).toBeCloseTo(0.55, 2);
    const clicksBeforeDisabledAttempt = await clickCount(button);
    await page.mouse.click(center.x, center.y);
    await expect
      .poll(() => clickCount(button))
      .toBe(clicksBeforeDisabledAttempt);

    await button.evaluate((element) => {
      const target = element as HTMLButtonElement;
      target.disabled = false;
      target.blur();
    });
    await page.mouse.move(2, 2);
    await expect.poll(() => computedOpacity(button)).toBeCloseTo(0.97, 2);
  });
});

function alphaButton(page: Page): Locator {
  return designFrame(page).locator(`[data-agent-native-node-id="${NODE_ID}"]`);
}

function interactionStateTrigger(page: Page): Locator {
  return page.locator('button[aria-label="Interaction state"]');
}

function stateOption(page: Page, state: StateValue): Locator {
  return page.locator(`[data-interaction-state-option="${state}"]`);
}

function selectedLayerRow(page: Page): Locator {
  return page.locator('[role="treeitem"][aria-selected="true"]').first();
}

function inspectorOpacityInput(page: Page): Locator {
  return page.locator('input[aria-label="Opacity" i]').first();
}

async function setInspectorOpacity(page: Page, percent: number): Promise<void> {
  const input = inspectorOpacityInput(page);
  await expect(input).toBeVisible();
  await input.fill(String(percent));
  await input.press("Enter");
}

async function selectInteractionState(
  page: Page,
  state: StateValue,
): Promise<void> {
  const trigger = interactionStateTrigger(page);
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const option = stateOption(page, state);
  await expect(option).toBeVisible();
  await option.click();
  await expect(trigger).toHaveAttribute("data-interaction-state", state);
  await expect(trigger).toContainText(STATE_LABELS[state]);
}

async function expectStateMenuContract(
  page: Page,
  selectedState: StateValue,
): Promise<void> {
  const trigger = interactionStateTrigger(page);
  await expect(trigger).toHaveAttribute(
    "data-interaction-state",
    selectedState,
  );
  await trigger.click();
  const options = page.locator('[role="menuitemradio"]');
  await expect(options).toHaveCount(6);
  await expect(options).toHaveText([
    "Default",
    "Hover",
    "Focus",
    "Focus visible",
    "Pressed",
    "Disabled",
  ]);
  for (const state of Object.keys(STATE_LABELS) as StateValue[]) {
    await expect(stateOption(page, state)).toHaveAttribute(
      "aria-checked",
      String(state === selectedState),
    );
  }
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("menu", { name: "Interaction state" }),
  ).toHaveCount(0);
}

async function computedOpacity(button: Locator): Promise<number> {
  return button.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).opacity),
  );
}

async function pseudoMatches(button: Locator, selector: string) {
  return button.evaluate((element, value) => element.matches(value), selector);
}

async function clickCount(button: Locator): Promise<number> {
  return button.evaluate(
    (element) =>
      (element as HTMLButtonElement & { __clickCount?: number }).__clickCount ??
      0,
  );
}

async function pressEditorShortcut(
  page: Page,
  key: string,
  options: { shift?: boolean } = {},
): Promise<void> {
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
  await page.keyboard.press(
    [PRIMARY, options.shift ? "Shift" : "", key.toUpperCase()]
      .filter(Boolean)
      .join("+"),
  );
}

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
): Promise<any> {
  const response = await page.request.post(
    `${new URL(page.url()).origin}/_agent-native/actions/${name}`,
    {
      data: input,
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!response.ok()) {
    throw new Error(
      `${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function fileContent(page: Page): Promise<string> {
  const params = new URLSearchParams({ id: designId });
  const response = await page.request.get(
    `${new URL(page.url()).origin}/_agent-native/actions/get-design?${params}`,
    { headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok()) {
    throw new Error(
      `get-design failed: ${response.status()} ${await response.text()}`,
    );
  }
  const result = await response.json();
  const file = (result.files ?? []).find(
    (candidate: { filename?: string }) => candidate.filename === "index.html",
  );
  if (typeof file?.content !== "string") {
    throw new Error("index.html missing from get-design response");
  }
  return file.content;
}

function inlineOpacity(htmlPromise: Promise<string>): Promise<string> {
  return htmlPromise.then((html) => {
    const tag = new RegExp(
      `<button[^>]*data-agent-native-node-id="${NODE_ID}"[^>]*>`,
      "i",
    ).exec(html)?.[0];
    return (
      /(?:^|;)\s*opacity\s*:\s*([^;"']+)/i.exec(tag ?? "")?.[1]?.trim() ?? ""
    );
  });
}

function stateOpacity(html: string, state: Exclude<StateValue, "default">) {
  return stateProperty(html, state, "opacity");
}

function stateProperty(
  html: string,
  state: Exclude<StateValue, "default">,
  property: string,
): string {
  const body = new RegExp(
    `\\[data-agent-native-node-id="${NODE_ID}"\\]:${state}\\s*\\{([^}]*)\\}`,
    "i",
  ).exec(html)?.[1];
  if (!body) return "";
  return (
    new RegExp(`${property}\\s*:\\s*([^;!]+)`, "i").exec(body)?.[1]?.trim() ??
    ""
  );
}
