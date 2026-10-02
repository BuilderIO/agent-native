import { test, type Browser } from "@playwright/test";

import { skipUnlessAuthed } from "../lib/authed";
import { ChatReliabilitySession } from "../lib/chat-reliability";
import {
  FULL_RELIABILITY_APPS,
  RELIABILITY_TAG,
} from "../lib/chat-reliability-core";
import {
  multiTurnPersists,
  refreshMidRun,
  secondMessageWhileRunning,
  stopMidStream,
  toolCallMutatesData,
} from "../lib/chat-reliability-flows";
import { chatSites, type BetaSite } from "../lib/fleet";
import { quarantineChatHostSpend } from "../lib/quarantine";

/**
 * Agent chat runs that "did not finish" are the most-reported beta breakage:
 * the stream ends early, a second message gets "Run already in progress",
 * Stop leaves "Starting agent", a refresh loses the answer. Each test here
 * asserts one thing a user can see, on a thread of its own, and names the
 * thread and the server's view of it when it fails.
 *
 * Cost per run, in luna turns: refresh mid-run 1, second message 2, Stop 2,
 * multi-turn 2, tool call 1. Apps outside FULL_RELIABILITY_APPS run only the
 * first.
 */
skipUnlessAuthed();

test.describe.configure({ mode: "parallel" });

async function withSession(
  browser: Browser,
  site: BetaSite,
  name: string,
  body: (session: ChatReliabilitySession) => Promise<void>,
): Promise<void> {
  quarantineChatHostSpend(site.id);
  const session = await ChatReliabilitySession.create(browser, site, name);
  try {
    await session.run(async () => {
      await session.open();
      await body(session);
    });
  } finally {
    await session.close();
  }
}

for (const site of chatSites()) {
  const full = FULL_RELIABILITY_APPS.includes(site.id);

  test.describe(`${site.id} agent chat reliability`, () => {
    test(`${RELIABILITY_TAG} refresh mid-run restores the complete answer`, async ({
      browser,
    }) => {
      test.setTimeout(420_000);
      await withSession(browser, site, "refresh mid-run", refreshMidRun);
    });

    if (!full) return;

    test(`${RELIABILITY_TAG} a second message during a run gets no error and both are answered`, async ({
      browser,
    }) => {
      test.setTimeout(360_000);
      await withSession(
        browser,
        site,
        "second message during a run",
        secondMessageWhileRunning,
      );
    });

    test(`${RELIABILITY_TAG} Stop returns the composer to idle and the thread still works`, async ({
      browser,
    }) => {
      test.setTimeout(300_000);
      await withSession(browser, site, "stop mid-stream", stopMidStream);
    });

    test(`${RELIABILITY_TAG} two turns persist, list in history, and survive a reload`, async ({
      browser,
    }) => {
      test.setTimeout(420_000);
      await withSession(
        browser,
        site,
        "multi-turn persistence",
        multiTurnPersists,
      );
    });

    test(`${RELIABILITY_TAG} a tool call really changes data and leaks no internal error`, async ({
      browser,
    }) => {
      test.setTimeout(300_000);
      await withSession(
        browser,
        site,
        "tool call mutates data",
        toolCallMutatesData,
      );
    });
  });
}
