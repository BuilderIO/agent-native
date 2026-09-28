import { expect, test } from "@playwright/test";

import { renderedText } from "../lib/app";
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
import {
  authenticatedEntryPath,
  originFor,
  selectedSites,
  siteById,
} from "../lib/fleet";

skipUnlessAuthed();

const selected = new Set(selectedSites().map((site) => site.id));

test.describe("slides -> analytics delegation", () => {
  test.skip(
    !selected.has("slides"),
    "slides is not in this run's app selection",
  );

  const slides = siteById("slides");
  const origin = originFor(slides);

  test("delegates an analytics question and renders the answer", async ({
    browser,
  }) => {
    test.setTimeout(600_000);

    const context = await signedInContext(browser, slides);
    try {
      await assertSignedInOnBeta(context, slides);

      const page = await context.newPage();
      const chat = watchChatRequests(page);

      await page.goto(
        `${origin}${authenticatedEntryPath(slides)}?agentSidebar=open`,
        {
          waitUntil: "domcontentloaded",
          timeout: 45_000,
        },
      );
      await expect(page.locator(VISIBLE_COMPOSER.input).first()).toBeVisible({
        timeout: 60_000,
      });

      await sendPromptAndAwaitTurn(
        page,
        "Ask the analytics agent what data sources it can query. Do not create or edit a deck, and do not change anything. Just report what it says in one sentence.",
        { turnTimeoutMs: 420_000 },
      );

      chat.assertOnlyLuna();

      const workSummary = page.getByRole("button", {
        name: /^Worked(?: for\b)?/i,
      });
      await expect(workSummary).toBeVisible({ timeout: 20_000 });
      await workSummary.click();

      const transcript = await renderedText(
        page,
        "beta.slides delegation transcript",
      );

      expect(
        transcript,
        `Slides never delegated to Analytics — no "Asking analytics"/"Asked analytics" step appeared in the transcript. This is the shape of "Slides isn't connected to Analytics anymore".`,
      ).toMatch(/Ask(ing|ed) analytics/i);

      expect(
        transcript,
        `Slides delegated to Analytics and the call failed ("Error asking analytics")`,
      ).not.toMatch(/Error asking analytics/i);

      await assertNoChatFailure(page, "beta.slides -> analytics delegation");
    } finally {
      await context.close();
    }
  });
});

test.describe("A2A reachability between deployed peers", () => {
  test("every selected host's A2A endpoint answers its peers", async ({
    browser,
  }) => {
    const slides = siteById("slides");
    test.skip(!selected.has("slides"), "slides is not in this run's selection");

    const context = await signedInContext(browser, slides, {
      seedModel: false,
    });
    try {
      const page = await context.newPage();
      await page.goto(`${originFor(slides)}${authenticatedEntryPath(slides)}`, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });

      const peers = await page.evaluate(async () => {
        const response = await fetch("/_agent-native/agents?selfAppId=slides", {
          headers: { accept: "application/json" },
        });
        const text = await response.text();
        const parsed = JSON.parse(text) as
          | { id?: string; url?: string }[]
          | { agents?: { id?: string; url?: string }[] };
        return Array.isArray(parsed) ? parsed : (parsed.agents ?? []);
      });

      const analytics = peers.find((peer) => peer.id === "analytics");
      expect(
        analytics,
        `Slides does not have Analytics registered as a peer at all. Peers seen: ${peers.map((p) => p.id).join(", ")}`,
      ).toBeTruthy();

      const probe = await page.evaluate(async (url: string) => {
        const response = await fetch(
          `/_agent-native/agents/probe?url=${encodeURIComponent(url)}`,
          { headers: { accept: "application/json" } },
        );
        return { status: response.status, body: await response.text() };
      }, analytics!.url!);

      expect(
        probe.status,
        `Peer probe for ${analytics!.url} returned HTTP ${probe.status}: ${probe.body.slice(0, 200)}`,
      ).toBe(200);

      const verdict = JSON.parse(probe.body) as {
        reachable?: boolean;
        authorized?: boolean;
      };
      expect(
        verdict.reachable,
        `Slides cannot reach Analytics at ${analytics!.url}: ${probe.body.slice(0, 200)}`,
      ).toBe(true);
      expect(
        verdict.authorized,
        `Slides reaches Analytics at ${analytics!.url} but is not authorized — the two apps do not share a signing secret, so every delegated call is rejected`,
      ).toBe(true);
    } finally {
      await context.close();
    }
  });
});
