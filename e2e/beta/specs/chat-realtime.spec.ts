import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import {
  assertSignedInOnBeta,
  signedInContext,
  skipUnlessAuthed,
} from "../lib/authed";
import {
  assertNoChatFailure,
  sendPromptAndAwaitTurn,
  VISIBLE_COMPOSER,
  watchChatRequests,
} from "../lib/chat";
import { originFor, selectedSites, siteById } from "../lib/fleet";

skipUnlessAuthed();

const selected = new Set(selectedSites().map((site) => site.id));
const IDLE_MEASUREMENT_MS = 10 * 60_000;
const MAIN_SLIDE_CANVAS = '[data-main-slide-canvas="true"]';

test.describe("Slides realtime editor", () => {
  test.skip(!selected.has("slides"), "slides is not in this run's selection");

  test("shows a chat edit live in two pages and records idle transport traffic", async ({
    browser,
  }) => {
    test.setTimeout(1_500_000);

    const site = siteById("slides");
    const origin = originFor(site);
    const context = await signedInContext(browser, site);
    const suffix =
      `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
    const slideId = `e2e-slide-${suffix.toLowerCase()}`;
    const sourceText = `E2E_SOURCE_${suffix}`;
    const updatedText = `E2E_UPDATED_${suffix}`;
    const objectId = `e2e-object-${suffix.toLowerCase()}`;
    let deckId: string | undefined;
    let pageA: Page | undefined;
    let pageB: Page | undefined;

    try {
      await assertSignedInOnBeta(context, site);
      pageA = await context.newPage();

      const html = `<div class="fmd-slide" style="padding: 80px 110px; display: flex; align-items: center; justify-content: center; background: #0f172a; color: #f8fafc; font-family: Arial, sans-serif;"><div data-slide-object-id="${objectId}" style="font-size: 38px; font-weight: 700;">${sourceText}</div></div>`;
      const created = await postAction(pageA.request, origin, "create-deck", {
        title: `Beta E2E realtime ${suffix}`,
        slides: [{ id: slideId, content: html, layout: "blank" }],
        contextModeOverride: "off",
      });
      deckId = readDeckId(created);

      const editorUrl = `${origin}/deck/${deckId}`;
      await openEditor(pageA, `${editorUrl}?agentSidebar=open`, sourceText);
      pageB = await context.newPage();
      await openEditor(pageB, editorUrl, sourceText);

      const pageADocument = await markDocument(pageA);
      const pageBDocument = await markDocument(pageB);
      await pageA.bringToFront();
      await expect
        .poll(() => pageA!.evaluate(() => document.visibilityState))
        .toBe("visible");
      await expect
        .poll(() => pageB!.evaluate(() => document.visibilityState))
        .toBe("hidden");

      const chat = watchChatRequests(pageA);
      const prompt = [
        "Use the Slides update-slide action to edit exactly one existing slide.",
        `deckId=${deckId}; slideId=${slideId}.`,
        `Replace the exact text ${sourceText} with ${updatedText} using one edits item with expectedMatches=1.`,
        `After the write, use get-deck for slide ${slideId} to verify ${updatedText}, then reply with exactly ${updatedText}.`,
        "Do not add, delete, reorder, or otherwise modify slides.",
      ].join(" ");

      let turnFinished = false;
      let turnError: unknown;
      const turn = sendPromptAndAwaitTurn(pageA, prompt, {
        turnTimeoutMs: 420_000,
      }).then(
        () => {
          turnFinished = true;
        },
        (error: unknown) => {
          turnError = error;
          turnFinished = true;
        },
      );
      const activeRunEditDeadline = Date.now() + 360_000;
      let pageAUpdatedDuringRun = false;
      const activeRunStop = pageA.locator(VISIBLE_COMPOSER.stop).first();
      const pageACanvas = pageA.locator(MAIN_SLIDE_CANVAS);
      while (!turnFinished && Date.now() < activeRunEditDeadline) {
        const renderedText = await pageACanvas.innerText().catch(() => "");
        const stopVisible = await activeRunStop.isVisible().catch(() => false);
        if (renderedText.includes(updatedText) && stopVisible) {
          pageAUpdatedDuringRun = true;
          break;
        }
        await pageA.waitForTimeout(250);
      }
      await turn;
      if (turnError) throw turnError;

      expect(
        pageAUpdatedDuringRun,
        "the Slides canvas did not show the agent edit while the chat run was active",
      ).toBe(true);
      expect(await readDocument(pageA)).toBe(pageADocument);
      chat.assertOnlyLuna();
      await assertNoChatFailure(pageA, "beta.slides live editor edit");

      const pageBCanvas = pageB.locator(MAIN_SLIDE_CANVAS);
      await pageB.bringToFront();
      await expect
        .poll(() => pageB!.evaluate(() => document.visibilityState))
        .toBe("visible");
      await expect(pageBCanvas).toContainText(updatedText, { timeout: 90_000 });
      expect(await readDocument(pageB)).toBe(pageBDocument);

      const transportRequests = { poll: 0, events: 0 };
      pageB.on("request", (request) => {
        if (request.method() !== "GET") return;
        const pathname = new URL(request.url()).pathname.replace(/\/+$/, "");
        if (pathname === "/poll" || pathname.endsWith("/_agent-native/poll")) {
          transportRequests.poll += 1;
        } else if (
          pathname === "/events" ||
          pathname.endsWith("/_agent-native/events")
        ) {
          transportRequests.events += 1;
        }
      });

      const idleWindowStartedAt = Date.now();
      await pageB.waitForTimeout(IDLE_MEASUREMENT_MS);
      const idleWindowMs = Date.now() - idleWindowStartedAt;
      expect(idleWindowMs).toBeGreaterThanOrEqual(IDLE_MEASUREMENT_MS);
      expect(await pageB.evaluate(() => document.visibilityState)).toBe(
        "visible",
      );
      expect(await readDocument(pageB)).toBe(pageBDocument);
      console.info(
        `[beta-slides-realtime] idle transport window ${JSON.stringify({ idleWindowMs, pollRequests: transportRequests.poll, eventsRequests: transportRequests.events, tab: "pageB" })}`,
      );
    } finally {
      try {
        if (deckId) {
          await postAction(context.request, origin, "delete-deck", {
            id: deckId,
          });
        }
      } finally {
        await context.close();
      }
    }
  });
});

async function openEditor(
  page: Page,
  url: string,
  text: string,
): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await expect(page.locator(MAIN_SLIDE_CANVAS)).toContainText(text, {
    timeout: 90_000,
  });
}

async function markDocument(page: Page): Promise<string> {
  return page.evaluate(() => {
    const identity = `${performance.timeOrigin}:${Math.random()}`;
    (
      window as Window & { __betaSlidesRealtimeDocument?: string }
    ).__betaSlidesRealtimeDocument = identity;
    return identity;
  });
}

async function readDocument(page: Page): Promise<string | undefined> {
  return page.evaluate(
    () =>
      (window as Window & { __betaSlidesRealtimeDocument?: string })
        .__betaSlidesRealtimeDocument,
  );
}

async function postAction(
  request: APIRequestContext,
  origin: string,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const response = await request.post(
    `${origin}/_agent-native/actions/${name}`,
    {
      data: input,
      headers: { "Content-Type": "application/json" },
      timeout: 60_000,
    },
  );
  if (!response.ok()) {
    throw new Error(
      `${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

function readDeckId(result: unknown): string {
  if (!result || typeof result !== "object") {
    throw new Error("create-deck returned no deck result");
  }
  const record = result as Record<string, unknown>;
  const data =
    record.data && typeof record.data === "object"
      ? (record.data as Record<string, unknown>)
      : undefined;
  const deck =
    record.deck && typeof record.deck === "object"
      ? (record.deck as Record<string, unknown>)
      : undefined;
  const nestedResult =
    record.result && typeof record.result === "object"
      ? (record.result as Record<string, unknown>)
      : undefined;
  const id = [record.id, data?.id, deck?.id, nestedResult?.id].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (!id) throw new Error("create-deck returned no deck id");
  return id;
}
