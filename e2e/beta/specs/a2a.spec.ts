import { expect, test } from "@playwright/test";

import { renderedText } from "../lib/app";
import {
  assertSignedInOnBeta,
  signedInContext,
  skipUnlessAuthed,
} from "../lib/authed";
import {
  assertNoChatFailure,
  COMPOSER,
  sendPromptAndAwaitTurn,
  watchChatRequests,
} from "../lib/chat";
import { originFor, selectedSites, siteById } from "../lib/fleet";

/**
 * Cross-app delegation: Slides asking Analytics for data.
 *
 * Read the result carefully — the peer Slides reaches is **production**
 * Analytics, not beta Analytics. First-party peer URLs come from the template
 * registry, which stores one production URL per app and has no beta-aware
 * branch, so a beta deploy delegates across the lane boundary. That is worth
 * knowing on its own; it also means this test proves the delegation *path*
 * (discovery, signing, transport, rendering) rather than beta-to-beta
 * behaviour, and that a green result here does not clear beta Analytics.
 *
 * Slides is the right origin for this: its agent runs with local database
 * tools off, so an analytics-shaped question has no local shortcut and must be
 * delegated. That makes the assertion deterministic instead of hopeful.
 */

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

      await page.goto(`${origin}/?agentSidebar=open`, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      await expect(page.locator(COMPOSER.input).first()).toBeVisible({
        timeout: 60_000,
      });

      // Phrased with the trigger words the Slides delegation skill documents,
      // and explicitly read-only so a cross-lane call cannot write anything.
      await sendPromptAndAwaitTurn(
        page,
        "Ask the analytics agent what data sources it can query. Do not create or edit a deck, and do not change anything. Just report what it says in one sentence.",
        { turnTimeoutMs: 420_000 },
      );

      chat.assertOnlyLuna();

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
    // Cheap counterpart to the delegated turn above: a peer that is reachable
    // but not authorized, or authorized but unreachable, produces the same
    // "the other app just doesn't answer" symptom, and this separates them
    // without spending a turn.
    const slides = siteById("slides");
    test.skip(!selected.has("slides"), "slides is not in this run's selection");

    const context = await signedInContext(browser, slides, {
      seedModel: false,
    });
    try {
      const page = await context.newPage();
      await page.goto(`${originFor(slides)}/`, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
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
