import assert from "node:assert/strict";
import test from "node:test";

import type { Page } from "@playwright/test";

import {
  classifyPeerProbe,
  explainPeerProbe,
  peerProbePasses,
  settlePeerProbe,
} from "./a2a-probe";
import {
  attemptsFor,
  describeActionFailure,
  isTransientActionStatus,
  retryTransientAction,
} from "./action-retry";
import {
  evaluateAfterNavigation,
  isKnownThirdPartyPageError,
  visibilityControlScript,
} from "./app";
import {
  AGENT_COMPOSER_ROOT,
  composerHoldsPrompt,
  countOccurrences,
  VISIBLE_COMPOSER,
} from "./chat";

function fakePage(): { page: Page; loads: () => number } {
  let loads = 0;
  const page = {
    waitForLoadState: async () => {
      loads += 1;
    },
    url: () => "https://beta.chat.agent-native.com/home",
  } as unknown as Page;
  return { page, loads: () => loads };
}

const DESTROYED = new Error(
  "page.evaluate: Execution context was destroyed, most likely because of a navigation.\n  at x",
);

test("an evaluation that loses its page to a redirect runs once more, loudly", async () => {
  const { page, loads } = fakePage();
  const notes: string[] = [];
  let calls = 0;
  const result = await evaluateAfterNavigation(
    page,
    async () => {
      calls += 1;
      if (calls === 1) throw DESTROYED;
      return "ok";
    },
    (note) => notes.push(note),
  );
  assert.equal(result, "ok");
  assert.equal(calls, 2);
  assert.equal(loads(), 2);
  assert.equal(notes.length, 1);
  assert.match(
    notes[0],
    /ran again at https:\/\/beta\.chat\.agent-native\.com\/home/,
  );
});

test("a second destroyed context and any other error are not retried away", async () => {
  const notes: string[] = [];
  let calls = 0;
  await assert.rejects(
    evaluateAfterNavigation(
      fakePage().page,
      async () => {
        calls += 1;
        throw DESTROYED;
      },
      (note) => notes.push(note),
    ),
    /Execution context was destroyed/,
  );
  assert.equal(calls, 2);
  assert.equal(notes.length, 1);

  calls = 0;
  await assert.rejects(
    evaluateAfterNavigation(
      fakePage().page,
      async () => {
        calls += 1;
        throw new Error("fetch failed: HTTP 500");
      },
      (note) => notes.push(note),
    ),
    /HTTP 500/,
  );
  assert.equal(calls, 1);
  assert.equal(notes.length, 1);
});

test("an evaluation that succeeds first time records nothing", async () => {
  const notes: string[] = [];
  assert.equal(
    await evaluateAfterNavigation(
      fakePage().page,
      async () => 7,
      (note) => notes.push(note),
    ),
    7,
  );
  assert.deepEqual(notes, []);
});

test("classifies Vector page errors as third-party noise", () => {
  assert.equal(
    isKnownThirdPartyPageError(
      "Domain not allowed",
      "Error: Domain not allowed\n    at https://cdn.vector.co/pixel.js:1:33281",
    ),
    true,
  );
  assert.equal(
    isKnownThirdPartyPageError(
      "Failed to fetch",
      "TypeError: Failed to fetch\n    at https://beta.example.com/assets/app.js\n    at https://cdn.vector.co/pixel.js:2:33164",
    ),
    true,
  );
  assert.equal(
    isKnownThirdPartyPageError(
      "Failed to fetch",
      "TypeError: Failed to fetch\n    at https://beta.example.com/assets/app.js",
    ),
    false,
  );
  assert.equal(
    isKnownThirdPartyPageError(
      "Domain not allowed",
      "Error: Domain not allowed\n    at https://beta.example.com/assets/app.js",
    ),
    false,
  );
  assert.equal(
    isKnownThirdPartyPageError(
      "Failed to fetch",
      "TypeError: Failed to fetch\n    at https://cdn.example.test/pixel.js",
    ),
    false,
  );
});

test("the agent composer is matched by its stack, not by where it is mounted", () => {
  // A thread page (Dispatch /chat/:id, the Chat app) renders the same composer
  // outside the sidebar panel and in the default variant. Neither may be
  // required, or those hosts report "no agent composer".
  assert.ok(AGENT_COMPOSER_ROOT.includes(".agentkit-composer"));
  for (const selector of Object.values(VISIBLE_COMPOSER)) {
    assert.ok(selector.startsWith(`${AGENT_COMPOSER_ROOT}:visible`));
    assert.ok(!selector.includes("agent-sidebar-panel"));
    assert.ok(!selector.includes("data-agent-composer-variant"));
  }
  assert.match(VISIBLE_COMPOSER.send, /data-agent-composer-slot="send-button"/);
});

test("a typed prompt is recognized through the editor's whitespace", () => {
  const prompt =
    "Reply with exactly ANX9 and nothing else. Do not use any tools.";
  assert.equal(composerHoldsPrompt(prompt, prompt), true);
  assert.equal(
    composerHoldsPrompt(`\n${prompt.replace(/ /g, "  ")}\n`, prompt),
    true,
  );
  assert.equal(composerHoldsPrompt("\n", prompt), false);
  assert.equal(composerHoldsPrompt("Reply with exactly", prompt), false);
});

test("occurrences are counted, and an empty needle is refused", () => {
  assert.equal(countOccurrences("ANX9 and ANX9", "ANX9"), 2);
  assert.equal(countOccurrences("nothing here", "ANX9"), 0);
  assert.throws(() => countOccurrences("text", ""), /non-empty needle/);
});

test("a peer probe is read as authorized, rejected, undecided, card-problem, or unreachable", () => {
  const verdict = (status: number, body: unknown) =>
    classifyPeerProbe({ status, body: JSON.stringify(body) });
  const card = {
    reachable: true,
    cardStatus: "reachable",
    securitySchemes: ["jwtBearer"],
  };
  assert.equal(
    verdict(200, { reachable: true, authorized: true }),
    "authorized",
  );
  assert.equal(
    verdict(200, { reachable: true, authorized: false, authError: "401" }),
    "rejected",
  );
  assert.equal(
    verdict(200, { reachable: true, cardStatus: "auth-rejected" }),
    "rejected",
  );
  // What a plain `?url=` probe of a first-party peer answers: reachable, a card
  // that advertises signed calls, and no authorization verdict at all.
  assert.equal(verdict(200, card), "undecided");
  assert.equal(
    verdict(200, { ...card, authError: "This operation was aborted" }),
    "undecided",
  );
  assert.equal(
    verdict(200, { ...card, cardStatus: "no-json-rpc" }),
    "card-problem",
  );
  assert.equal(
    verdict(200, { ...card, securitySchemes: ["apiKey"] }),
    "card-problem",
  );
  assert.equal(
    verdict(200, { reachable: true, authError: "aborted" }),
    "card-problem",
  );
  assert.equal(verdict(200, { reachable: false, error: "503" }), "unreachable");
  assert.equal(verdict(500, { error: "boom" }), "probe-error");
  assert.equal(
    classifyPeerProbe({ status: 200, body: "<html>" }),
    "probe-error",
  );
});

test("only an authorized or an unverified-but-reachable peer passes", () => {
  assert.equal(peerProbePasses("authorized"), true);
  assert.equal(peerProbePasses("undecided"), true);
  for (const outcome of [
    "rejected",
    "unreachable",
    "card-problem",
    "probe-error",
  ] as const) {
    assert.equal(peerProbePasses(outcome), false, outcome);
  }
});

test("an unverified-but-reachable probe stops at the first answer and says authorization was not verified", async () => {
  const undecided = {
    status: 200,
    body: JSON.stringify({
      reachable: true,
      cardStatus: "reachable",
      securitySchemes: ["jwtBearer"],
    }),
  };
  let reads = 0;
  const settled = await settlePeerProbe(
    async () => {
      reads += 1;
      return undecided;
    },
    { attempts: 3, delayMs: 0, sleep: async () => undefined },
  );
  assert.equal(reads, 1);
  assert.equal(settled.outcome, "undecided");
  const message = explainPeerProbe(
    "Slides",
    "Analytics",
    "https://a.test",
    settled,
  );
  assert.match(message, /Authorization was not verified/);
  assert.doesNotMatch(message, /signing secret/);
  assert.match(message, /"securitySchemes":\["jwtBearer"\]/);
});

test("a card the probe cannot use is retried a bounded number of times and then reported with the full body", async () => {
  const broken = {
    status: 200,
    body: JSON.stringify({ reachable: true, cardStatus: "no-json-rpc" }),
  };
  let reads = 0;
  const settled = await settlePeerProbe(
    async () => {
      reads += 1;
      return broken;
    },
    { attempts: 3, delayMs: 0, sleep: async () => undefined },
  );
  assert.equal(reads, 3);
  assert.equal(settled.outcome, "card-problem");
  const message = explainPeerProbe(
    "Slides",
    "Analytics",
    "https://a.test",
    settled,
  );
  assert.match(message, /not usable for signed calls/);
  assert.match(message, /"cardStatus":"no-json-rpc"/);
});

test("a decisive probe answer stops the retries, and a rejection names the secret", async () => {
  const responses = [
    { status: 200, body: JSON.stringify({ reachable: false }) },
    {
      status: 200,
      body: JSON.stringify({
        reachable: true,
        authorized: false,
        authError: "401",
      }),
    },
  ];
  let reads = 0;
  const settled = await settlePeerProbe(async () => responses[reads++]!, {
    attempts: 3,
    delayMs: 0,
    sleep: async () => undefined,
  });
  assert.equal(reads, 2);
  assert.equal(settled.outcome, "rejected");
  assert.match(
    explainPeerProbe("Slides", "Analytics", "https://a.test", settled),
    /signing secret/,
  );
});

test("fixture actions retry transient failures and report every attempt", async () => {
  assert.equal(isTransientActionStatus(401), true);
  assert.equal(isTransientActionStatus(500), true);
  assert.equal(isTransientActionStatus(0), true);
  assert.equal(isTransientActionStatus(409), false);
  assert.equal(isTransientActionStatus(404), false);
  assert.equal(attemptsFor("create-file"), 3);
  assert.equal(attemptsFor("apply-component-prop-edit"), 1);

  const sequence = [
    { status: 401, body: "Unauthorized" },
    { status: 0, body: "Timeout 20000ms exceeded" },
    { status: 200, body: "{}" },
  ];
  let sent = 0;
  const recovered = await retryTransientAction(async () => sequence[sent++]!, {
    delayMs: 0,
    sleep: async () => undefined,
  });
  assert.equal(recovered.final.status, 200);
  assert.equal(recovered.history.length, 3);

  sent = 0;
  const conflict = await retryTransientAction(
    async () => {
      sent += 1;
      return { status: 409, body: "stale" };
    },
    { delayMs: 0, sleep: async () => undefined },
  );
  assert.equal(sent, 1, "a conflict is an answer, not a blip");
  assert.equal(conflict.final.status, 409);

  const exhausted = await retryTransientAction(
    async () => ({ status: 500, body: "db down" }),
    { delayMs: 0, sleep: async () => undefined },
  );
  const message = describeActionFailure("create-file", exhausted.history);
  assert.match(message, /failed after 3 attempt\(s\)/);
  assert.match(message, /#3 HTTP 500: db down/);
});

test("the visibility control hides and shows a page the way the app reads it", (t) => {
  class FakeDocument extends EventTarget {}
  for (const [name, value] of [
    ["visibilityState", "visible"],
    ["hidden", false],
  ] as const) {
    Object.defineProperty(FakeDocument.prototype, name, {
      configurable: true,
      get: () => value,
    });
  }
  const fakeDocument = new FakeDocument();
  const fakeWindow: Record<string, unknown> = {};
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = {
    window: globals.window,
    document: globals.document,
    Document: globals.Document,
  };
  Object.assign(globals, {
    window: fakeWindow,
    document: fakeDocument,
    Document: FakeDocument,
  });
  t.after(() => Object.assign(globals, saved));

  visibilityControlScript();
  const control = fakeWindow.__betaVisibility as {
    set(state: "visible" | "hidden"): void;
  };
  const read = () => [
    (fakeDocument as unknown as { visibilityState: string }).visibilityState,
    (fakeDocument as unknown as { hidden: boolean }).hidden,
  ];
  let changes = 0;
  fakeDocument.addEventListener("visibilitychange", () => {
    changes += 1;
  });

  assert.deepEqual(read(), ["visible", false]);
  control.set("hidden");
  assert.deepEqual(read(), ["hidden", true]);
  control.set("visible");
  assert.deepEqual(read(), ["visible", false]);
  assert.equal(changes, 2);

  visibilityControlScript();
  assert.equal(
    fakeWindow.__betaVisibility,
    control,
    "installing twice keeps one control",
  );
});
