import { expect, test, type Page } from "@playwright/test";

import { renderedText } from "../lib/app";
import {
  assertSignedInOnBeta,
  signedInContext,
  skipUnlessAuthed,
} from "../lib/authed";
import {
  assertNoChatFailure,
  formatChatRequestDiagnostics,
  MISSING_FINAL_RESPONSE,
  readComposerRuntimeState,
  sendPromptAndAwaitTurn,
  VISIBLE_COMPOSER,
  watchChatRequests,
} from "../lib/chat";
import { authenticatedEntryPath, chatSites, originFor } from "../lib/fleet";


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
): Promise<void> {
  await expect(
    page.locator(VISIBLE_COMPOSER.input).first(),
    `${siteHost} rendered no agent composer for a signed-in user`,
  ).toBeVisible({ timeout: 60_000 });
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

        await page.goto(
          `${origin}${authenticatedEntryPath(site)}?agentSidebar=open`,
          {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          },
        );

        await withChatDiagnostics(chat, async () => {
          await expectComposerVisible(page, site.host);

          await sendPromptAndAwaitTurn(page, PROMPT);

          chat.assertOnlyLuna();
          await assertNoChatFailure(page, `${site.host} (chat turn)`);

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

          await page.reload({
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          });
          const restoreUrl = new URL(page.url());
          restoreUrl.searchParams.set("agentSidebar", "open");
          await page.goto(restoreUrl.toString(), {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          });
          try {
            await expect(
              page.locator(VISIBLE_COMPOSER.input).first(),
              `${site.host} did not restore the composer after reloading a completed chat`,
            ).toBeVisible({ timeout: 60_000 });
          } catch (error) {
            throw new Error(
              `${error instanceof Error ? error.message : String(error)}\nComposer runtime: ${JSON.stringify(await readComposerRuntimeState(page))}`,
            );
          }
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
            page.locator(VISIBLE_COMPOSER.stop),
            `${site.host} restored a completed thread in the stuck "Thinking" state`,
          ).toBeHidden();
        });
      } finally {
        await context.close();
      }
    });

    test("clears the stop button when a turn ends", async ({ browser }) => {
      const context = await signedInContext(browser, site);
      try {
        const page = await context.newPage();
        const chat = watchChatRequests(page);
        await page.goto(
          `${origin}${authenticatedEntryPath(site)}?agentSidebar=open`,
          {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          },
        );
        await withChatDiagnostics(chat, async () => {
          await expectComposerVisible(page, site.host);

          await sendPromptAndAwaitTurn(page, PROMPT);

          chat.assertOnlyLuna();

          await expect(
            page.locator(VISIBLE_COMPOSER.stop),
            `${site.host} still shows the stop button after the turn ended — the composer is stuck in the "Thinking" state users reported`,
          ).toBeHidden();
          await expect(
            page.locator(VISIBLE_COMPOSER.send).first(),
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
      const context = await signedInContext(browser, site);
      try {
        const page = await context.newPage();
        await page.goto(
          `${origin}${authenticatedEntryPath(site)}?agentSidebar=open`,
          {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          },
        );
        const send = page.locator(VISIBLE_COMPOSER.send).first();
        await expect(send).toBeVisible({ timeout: 60_000 });

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
