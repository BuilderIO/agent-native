import { expect, test, type Page } from "@playwright/test";

import { renderedText } from "../lib/app";
import {
  assertSignedInOnBeta,
  signedInContext,
  skipUnlessAuthed,
} from "../lib/authed";
import {
  assertNoChatFailure,
  COMPOSER,
  formatChatRequestDiagnostics,
  installSidebarRuntimeTrace,
  MISSING_FINAL_RESPONSE,
  readSidebarRuntimeTrace,
  sendPromptAndAwaitTurn,
  watchChatRequests,
} from "../lib/chat";
import { authenticatedEntryPath, chatSites, originFor } from "../lib/fleet";

/**
 * One real agent turn per chat-bearing app, on luna.
 *
 * Agent chat failing is the second-most-reported beta problem and the one no
 * unauthenticated check can see: the endpoint answers 401 to everyone, so the
 * only way to know a turn completes is to take one.
 *
 * The prompt is deliberately trivial and read-only. This suite runs against
 * hosts that share a database with production for most apps, so a turn that
 * creates or edits anything would leave real residue in real data. What is
 * being proven is that the pipeline works end to end — auth, provider key,
 * model, stream, render — not that the model is clever.
 */

skipUnlessAuthed();

/**
 * A per-run nonce, so "the assistant replied" cannot be satisfied by the
 * rendered echo of the prompt itself.
 *
 * The prompt necessarily contains the token it asks for, and the transcript
 * shows the user's own bubble, so a single occurrence proves nothing. The
 * assertion below requires the token to appear twice — once from the user,
 * once from the assistant.
 */
const NONCE = `AN${Math.floor(Math.random() * 1e9)
  .toString(36)
  .toUpperCase()}`;
const PROMPT = `Reply with exactly ${NONCE} and nothing else. Do not use any tools.`;

const sites = chatSites();

async function expectComposerVisible(
  page: Page,
  siteHost: string,
  traceSlides: boolean,
): Promise<void> {
  try {
    await expect(
      page.locator(COMPOSER.input).first(),
      `${siteHost} rendered no agent composer for a signed-in user`,
    ).toBeVisible({ timeout: 60_000 });
  } catch (error) {
    if (!traceSlides) throw error;
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nSlides sidebar runtime: ${JSON.stringify(await readSidebarRuntimeTrace(page))}`,
    );
  }
}

async function withChatDiagnostics<T>(
  chat: ReturnType<typeof watchChatRequests>,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${formatChatRequestDiagnostics(chat.log)}`,
    );
  }
}
test.describe.configure({ mode: "parallel" });

for (const site of sites) {
  const origin = originFor(site);

  test.describe(`${site.id} agent chat`, () => {
    test("completes and restores a turn on luna without an error state", async ({
      browser,
    }) => {
      const context = await signedInContext(browser, site);
      try {
        await assertSignedInOnBeta(context, site);

        const page = await context.newPage();
        const chat = watchChatRequests(page);
        if (site.id === "slides") await installSidebarRuntimeTrace(page);

        // The sidebar is collapsed by default on some entry paths; asking for
        // it explicitly is what guarantees a composer to type into.
        await page.goto(
          `${origin}${authenticatedEntryPath(site)}?agentSidebar=open`,
          {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          },
        );

        await withChatDiagnostics(chat, async () => {
          await expectComposerVisible(page, site.host, site.id === "slides");

          await sendPromptAndAwaitTurn(page, PROMPT);

          // Order matters: prove what was billed before judging the output, so a
          // turn that succeeded on the wrong model still fails the run.
          chat.assertOnlyLuna();
          await assertNoChatFailure(page, `${site.host} (chat turn)`);

          // The product's own signal that a turn ended with nothing to show.
          await expect(
            page.locator(MISSING_FINAL_RESPONSE),
            `${site.host} ended the turn without a final assistant message`,
          ).toHaveCount(0);

          const transcript = await renderedText(
            page,
            `${site.host} transcript`,
          );
          const echoes = transcript.split(NONCE).length - 1;
          expect(
            echoes,
            `${site.host} shows ${echoes} occurrence(s) of ${NONCE}. One is the user's own message; a second is the only evidence the assistant actually replied.`,
          ).toBeGreaterThanOrEqual(2);

          // Reported repeatedly: the turn completes, but returning to the app
          // loses the active thread or leaves the transcript blank. Reload the
          // real page so localStorage restoration and the server read path both
          // have to recover the thread that just completed.
          await page.reload({
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          });
          await expect(
            page.locator(COMPOSER.input).first(),
            `${site.host} did not restore the composer after reloading a completed chat`,
          ).toBeVisible({ timeout: 60_000 });
          await expect
            .poll(
              async () => {
                const restoredTranscript = await page
                  .locator("body")
                  .innerText();
                return restoredTranscript.split(NONCE).length - 1;
              },
              {
                timeout: 60_000,
                message: `${site.host} did not restore both the user prompt and assistant response after reload`,
              },
            )
            .toBeGreaterThanOrEqual(2);
          await assertNoChatFailure(page, `${site.host} (restored chat turn)`);
          await expect(
            page.locator(MISSING_FINAL_RESPONSE),
            `${site.host} restored a completed thread with a missing-final marker`,
          ).toHaveCount(0);
          await expect(
            page.locator(COMPOSER.stop),
            `${site.host} restored a completed thread in the stuck "Thinking" state`,
          ).toBeHidden();
        });
      } finally {
        await context.close();
      }
    });

    test("clears the stop button when a turn ends", async ({ browser }) => {
      // Reported repeatedly: the agent says it stopped, but the UI stays in
      // "Thinking" with the stop button active, so the next message cannot be
      // sent without manually stopping first.
      const context = await signedInContext(browser, site);
      try {
        const page = await context.newPage();
        const chat = watchChatRequests(page);
        if (site.id === "slides") await installSidebarRuntimeTrace(page);
        await page.goto(
          `${origin}${authenticatedEntryPath(site)}?agentSidebar=open`,
          {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          },
        );
        await withChatDiagnostics(chat, async () => {
          await expectComposerVisible(page, site.host, site.id === "slides");

          await sendPromptAndAwaitTurn(page, PROMPT);

          // `toBeHidden()` also passes for an element that never existed, so a
          // turn that never started would satisfy the assertion below without
          // exercising anything. Prove a turn actually left the browser first.
          chat.assertOnlyLuna();

          await expect(
            page.locator(COMPOSER.stop),
            `${site.host} still shows the stop button after the turn ended — the composer is stuck in the "Thinking" state users reported`,
          ).toBeHidden();
          await expect(
            page.locator(COMPOSER.send).first(),
            `${site.host} left the composer with neither a send nor a stop control after the turn`,
          ).toBeVisible();
        });
      } finally {
        await context.close();
      }
    });

    test("keeps the environment badge clear of the send button", async ({
      browser,
    }) => {
      // Reported directly: "The Beta/Prod button in the lower right covers
      // over the send chat button." Both are fixed to the bottom-right, so
      // this is a geometry question with a definite answer.
      const context = await signedInContext(browser, site);
      try {
        const page = await context.newPage();
        if (site.id === "slides") await installSidebarRuntimeTrace(page);
        await page.goto(
          `${origin}${authenticatedEntryPath(site)}?agentSidebar=open`,
          {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          },
        );
        const send = page.locator(COMPOSER.send).first();
        try {
          await expect(send).toBeVisible({ timeout: 60_000 });
        } catch (error) {
          if (site.id !== "slides") throw error;
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\nSlides sidebar runtime: ${JSON.stringify(await readSidebarRuntimeTrace(page))}`,
          );
        }

        const badge = page.locator(
          'button[aria-label*="switcher" i], button[aria-label*="beta" i]',
        );
        test.skip(
          (await badge.count()) === 0,
          `${site.id} renders no environment switcher`,
        );

        const sendBox = await send.boundingBox();
        const badgeBox = await badge.first().boundingBox();
        test.skip(!sendBox || !badgeBox, "control not laid out");

        const overlaps =
          sendBox!.x < badgeBox!.x + badgeBox!.width &&
          badgeBox!.x < sendBox!.x + sendBox!.width &&
          sendBox!.y < badgeBox!.y + badgeBox!.height &&
          badgeBox!.y < sendBox!.y + sendBox!.height;

        expect(
          overlaps,
          `${site.host} renders the beta/prod switcher (${JSON.stringify(badgeBox)}) overlapping the send button (${JSON.stringify(sendBox)}), so the switcher intercepts clicks meant for send`,
        ).toBe(false);
      } finally {
        await context.close();
      }
    });
  });
}
