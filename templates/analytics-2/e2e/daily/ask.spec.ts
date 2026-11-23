import { MISSING_PROJECT_TITLE } from "../local/fake-model";
import {
  askFromHome,
  chartFigure,
  chartThread,
  heroEditor,
  openHomeReady,
  placeholderOf,
  THREAD_URL,
  threadEditor,
  watchForText,
  waitForSendReady,
} from "./ask.helpers";
import { expect, test } from "./fixtures";

const HOME = /\/home$/;

test("ASK-01 ask from Home: Enter shows the question and opens the thread", async ({
  daily,
}) => {
  const { page } = daily;
  await openHomeReady(daily);
  await heroEditor(page).focus();
  await daily.type("[stream] which month had the most orders");
  await daily.check({ url: HOME, focus: heroEditor(page) });
  await waitForSendReady(page);
  await daily.press("Enter");
  await expect(
    page.getByText("[stream] which month had the most orders").first(),
  ).toBeVisible({ timeout: 400 });
  await expect(page).toHaveURL(THREAD_URL, { timeout: 10_000 });
  await expect(page.getByText("the last piece").first()).toBeVisible({
    timeout: 20_000,
  });
  await daily.check({ url: THREAD_URL });
});

// Reference: 744fc6b3:1048–1161 acknowledges submission before awaiting thread creation.
test("ASK-01 report A2-COMPOSER-HELD-ENTER-FORWARDING Enter right after Home loads sends the question", async ({
  daily,
}) => {
  const { page } = daily;
  const question = "[stream] first thing after load";
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  await page.route(
    /\/_agent-native\/actions\/manage-agent-engine(?:\?|$)/,
    async (route) => {
      await gate;
      await route.fallback();
    },
  );
  let acceptedStatus: number | undefined;
  page.on("response", (response) => {
    if (
      response.request().method() === "POST" &&
      response.url().startsWith(daily.server.base) &&
      response.url().includes("/agent-chat") &&
      (response.request().postData()?.includes(question) ?? false)
    )
      acceptedStatus = response.status();
  });
  try {
    await daily.open("/home");
    await expect(heroEditor(page)).toBeFocused({ timeout: 30_000 });
    await daily.type(question);
    await daily.press("Enter");
    release();
    await expect
      .poll(() => acceptedStatus, {
        message: "the first Enter submits the question",
      })
      .toBe(200);
    await expect(page).toHaveURL(THREAD_URL, { timeout: 10_000 });
    await expect(
      page.getByText(question, { exact: true }).first(),
    ).toBeVisible();
    await daily.check({ url: THREAD_URL });
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("ASK-01 a successful send never flashes a save failure", async ({
  daily,
}) => {
  test.fail();
  // FINDING COV-ASK-01: the new thread page shows "Save failed" for several seconds while the first answer is still coming, on a send that succeeds.
  const { page } = daily;
  await openHomeReady(daily);
  const seen = await watchForText(page, "Save failed");
  await heroEditor(page).focus();
  await daily.type("[stream] orders by region");
  await waitForSendReady(page);
  await daily.press("Enter");
  await expect(page).toHaveURL(THREAD_URL, { timeout: 10_000 });
  await expect(page.getByText("the last piece").first()).toBeVisible({
    timeout: 20_000,
  });
  expect(await seen(), '"Save failed" appeared during a successful send').toBe(
    false,
  );
});

test("ASK-02 Home prompt is focused with the original placeholder", async ({
  daily,
}) => {
  test.fail();
  // FINDING F5: the Home placeholder reads "Ask a data question or describe a data app to build..." (the app-builder mode's text), not the thread mode's.
  const { page } = daily;
  await daily.open("/home");
  await expect(heroEditor(page)).toBeFocused({ timeout: 30_000 });
  await daily.check({ url: HOME, focus: heroEditor(page) });
  await expect(placeholderOf(heroEditor(page))).toHaveAttribute(
    "data-placeholder",
    "Ask a data question and chat in a thread...",
    { timeout: 400 },
  );
});

test("ASK-03 mode variants change the placeholder", async ({ daily }) => {
  test.fail();
  // FINDING COV-ASK-02: "Analyze in a notebook" creates a project instead of switching the prompt's mode; there is no "Generate an app" mode.
  const { page } = daily;
  await openHomeReady(daily);
  const notebook = page.getByRole("button", {
    name: "Analyze in a notebook",
    exact: true,
  });
  await expect(notebook).toBeVisible();
  let created: string | null = null;
  try {
    await notebook.click();
    const match = /\/project\/([^/]+)/.exec(page.url());
    created = match?.[1] ?? null;
    await expect(page, "picking a mode stays on Home").toHaveURL(HOME, {
      timeout: 400,
    });
    await expect(placeholderOf(heroEditor(page))).toHaveAttribute(
      "data-placeholder",
      "Ask a data question and collaborate on cells in a project...",
      { timeout: 400 },
    );
    await page
      .getByRole("button", { name: "Generate an app", exact: true })
      .click({ timeout: 400 });
    await expect(placeholderOf(heroEditor(page))).toHaveAttribute(
      "data-placeholder",
      "Ask a data question or describe a data app to build...",
      { timeout: 400 },
    );
  } finally {
    const match = /\/project\/([^/]+)/.exec(page.url());
    created ??= match?.[1] ?? null;
    if (created) await daily.cleanupProject(created);
  }
});

test("ASK-04 a failed send shows the failure toast and keeps the question", async ({
  daily,
}) => {
  test.fail();
  // FINDING COV-ASK-03: when the send request fails, no "Error submitting your prompt" toast appears.
  const { page } = daily;
  daily.allowResponse = [/\/_agent-native\/agent-chat(\?|$)/];
  await page.route(/\/_agent-native\/agent-chat(\?|$)/, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 500,
          body: '{"error":"boom"}',
          contentType: "application/json",
        })
      : route.fallback(),
  );
  await openHomeReady(daily);
  await heroEditor(page).focus();
  await daily.type("[stream] a question that cannot be sent");
  await waitForSendReady(page);
  await page.keyboard.press("Enter");
  await expect(daily.toast("Error submitting your prompt")).toBeVisible({
    timeout: 400,
  });
  await expect(page).toHaveURL(HOME);
});

test("ASK-05 ask a follow-up inside a thread", async ({ daily }) => {
  const { page } = daily;
  await askFromHome(daily, "[stream] first question");
  await expect(page.getByText("the last piece").first()).toBeVisible({
    timeout: 20_000,
  });
  const path = new URL(page.url()).pathname;
  await threadEditor(page).focus();
  await daily.type("[slow] and the follow-up");
  await waitForSendReady(page);
  await daily.press("Enter");
  await expect(page.getByText("[slow] and the follow-up").first()).toBeVisible({
    timeout: 400,
  });
  await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible({
    timeout: 400,
  });
  await expect(
    page
      .getByText("Here is what I found for: [slow] and the follow-up")
      .first(),
  ).toBeVisible({ timeout: 20_000 });
  await daily.check({ url: new RegExp(`${path}$`) });
});

test("ASK-08 the first question returns a chart", async ({ daily }) => {
  const { page } = daily;
  const path = await chartThread(daily);
  const chart = chartFigure(page);
  await expect(chart).toHaveAccessibleName("Revenue by month");
  for (const label of ["Jan", "Feb", "Mar", "Apr"])
    await expect(chart.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("Revenue peaked in April.").first(),
  ).toBeVisible();
  await daily.check({ url: new RegExp(`${path}$`) });
});

for (const [id, name, label] of [
  ["ASK-09", "chart action Copy image", "Copy image"],
  ["ASK-10", "chart action Download image", "Download image"],
  ["ASK-11", "chart action View in notebook", "View in notebook"],
  ["ASK-12", "chart action Focus", "Focus"],
  ["ASK-13", "chart action Download CSV", "Download CSV"],
  ["ASK-14", "chart action Copy link to cell", "Copy link to cell"],
  ["ASK-15", "View cell on a referenced cell", "View cell"],
] as const) {
  test(`${id} ${name}`, async ({ daily }) => {
    test.fail();
    // FINDING COV-ASK-04: a chart in a thread answer has no output actions (Copy image, Download image, View in notebook, Focus, Download CSV, Copy link to cell, View cell).
    const { page } = daily;
    await chartThread(daily);
    await chartFigure(page).hover();
    await expect(
      page
        .getByRole("button", { name: label, exact: true })
        .or(page.getByRole("menuitem", { name: label, exact: true }))
        .first(),
    ).toBeVisible({ timeout: 400 });
  });
}

test("ASK-16 a mentioned project that does not exist is marked", async ({
  daily,
}) => {
  test.fail();
  // FINDING COV-ASK-05: a link to a missing project in an answer is a plain link; no "doesn't exist" marker.
  const { page } = daily;
  await askFromHome(daily, "[missing-project] where was the churn work");
  const mention = page
    .getByText(MISSING_PROJECT_TITLE, { exact: true })
    .first();
  await expect(mention).toBeVisible({ timeout: 20_000 });
  await mention.hover();
  await expect(
    page.getByText("The agent mentioned a project that doesn't exist"),
  ).toBeVisible({ timeout: 400 });
});

test("ASK-18 share a thread", async ({ daily }) => {
  test.fail();
  // FINDING COV-ASK-06: the thread page has no Share control (no "Share <title>" dialog with link-with/without-thread copies).
  const { page } = daily;
  await askFromHome(daily, "[stream] something to share");
  await expect(page.getByText("the last piece").first()).toBeVisible({
    timeout: 20_000,
  });
  await page
    .getByRole("button", { name: "Share", exact: true })
    .click({ timeout: 400 });
  await expect(daily.dialog().getByText(/^Share /)).toBeVisible({
    timeout: 400,
  });
  await expect(daily.dialog().getByText("Copy link with thread")).toBeVisible();
  await expect(
    daily.dialog().getByText("Copy link without thread"),
  ).toBeVisible();
});

test("ASK-19 stop a running answer", async ({ daily }) => {
  test.fail();
  // FINDING COV-ASK-07: Stop ends the run but nothing confirms it ("Successfully stopped run").
  const { page } = daily;
  await askFromHome(daily, "[slow] a long question to stop");
  const stop = page.getByRole("button", { name: /^Stop/ });
  await expect(stop).toBeVisible({ timeout: 5_000 });
  await daily.click(stop, { label: "Stop" });
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible({
    timeout: 400,
  });
  await expect(daily.toast("Successfully stopped run")).toBeVisible({
    timeout: 400,
  });
});

test("ASK-21 an agent tool error is shown with Fix with agent and Copy error", async ({
  daily,
}) => {
  test.fail();
  // FINDING COV-ASK-08: a failed agent step shows no inline error with "Fix with agent" / "Copy error".
  const { page } = daily;
  await askFromHome(daily, "[tool-error] open my project");
  await expect(
    page.getByText("That project could not be read.").first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole("button", { name: "Fix with agent" }),
  ).toBeVisible({ timeout: 400 });
  await expect(page.getByRole("button", { name: "Copy error" })).toBeVisible();
});
