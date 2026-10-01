import { mutationProbe, type ChatReliabilitySession } from "./chat-reliability";
import {
  assistantTextAfter,
  checkTranscript,
  describeState,
  exactReplyPrompt,
  isIdle,
  lineToken,
  LONG_ANSWER_LINES,
  longAnswerPrompt,
  newNonce,
  tail,
  type ChatState,
  type ExpectedTurn,
} from "./chat-reliability-core";

/**
 * The five reliability scenarios, one function each. The spec registers them
 * as tests; they take a session so they can also run against a stand-in page.
 */
const RUN_ID = process.env.GITHUB_RUN_ID ?? `local-${Date.now().toString(36)}`;
const LAST_LINE = LONG_ANSWER_LINES;

/** Null once every expected turn is in the transcript and the page is idle. */
function turnsFinished(
  state: ChatState,
  turns: readonly ExpectedTurn[],
): string | null {
  const problems = checkTranscript(state.messages, turns);
  if (problems.length > 0) {
    return `${problems.join("; ")} | ${describeState(state)}`;
  }
  return isIdle(state) ? null : describeState(state);
}

function streaming(state: ChatState, nonce: string): string | null {
  return assistantTextAfter(state.messages, nonce).includes(lineToken(nonce, 1))
    ? null
    : describeState(state);
}

export async function refreshMidRun(s: ChatReliabilitySession): Promise<void> {
  const nonce = newNonce();
  const turns: ExpectedTurn[] = [
    { userToken: nonce, answerToken: lineToken(nonce, 1) },
    { userToken: nonce, answerToken: lineToken(nonce, LAST_LINE) },
  ];
  await s.send(longAnswerPrompt(nonce), nonce);
  const midRun = await s.waitUntil(
    "the first streamed tokens",
    (state) => streaming(state, nonce),
    { timeoutMs: 60_000 },
  );
  await s.captureThreadId(nonce);
  if (isIdle(midRun)) {
    throw new Error(
      `the whole answer had streamed before the page could be reloaded, so a mid-run refresh was not exercised (${describeState(midRun)})`,
    );
  }
  s.annotate(
    "timing",
    `first tokens ${(s.elapsedMs() / 1000).toFixed(1)}s after load`,
  );

  await s.reload();
  await s.waitUntil(
    "the complete answer to be restored after a mid-run refresh, with the composer idle",
    (state) => turnsFinished(state, turns),
    { timeoutMs: 120_000 },
  );
  s.annotate(
    "timing",
    `complete ${(s.elapsedMs() / 1000).toFixed(1)}s after load`,
  );
  await s.assertComposerUsable();
  await s.assertClean("after refreshing mid-run");
  await s.assertServerRunIdle(20_000);
  await s.assertThreadPersisted({
    minMessages: 2,
    answerTokens: [lineToken(nonce, LAST_LINE)],
  });

  // A second reload restores from what was stored, not from a live run.
  await s.reload();
  await s.waitUntil(
    "the stored answer to be restored after reloading the finished thread",
    (state) => turnsFinished(state, turns),
    { timeoutMs: 60_000 },
  );
  await s.assertClean("after reloading the finished thread");
}

export async function secondMessageWhileRunning(
  s: ChatReliabilitySession,
): Promise<void> {
  const first = newNonce();
  const second = newNonce();
  const turns: ExpectedTurn[] = [
    { userToken: first, answerToken: lineToken(first, LAST_LINE) },
    { userToken: second, answerToken: second },
  ];
  await s.send(longAnswerPrompt(first), first);
  await s.waitUntil(
    "the first answer to start streaming",
    (state) => streaming(state, first),
    { timeoutMs: 60_000 },
  );
  await s.captureThreadId(first);

  await s.send(exactReplyPrompt(second), second, { expectTurnPost: false });
  const afterSecond = await s.readState();
  if (
    afterSecond.ok &&
    assistantTextAfter(afterSecond.state.messages, first).includes(
      lineToken(first, LAST_LINE),
    )
  ) {
    throw new Error(
      "the first answer had already finished when the second message was sent, so a message during an active run was not exercised",
    );
  }

  await s.waitUntil(
    "both answers to arrive in order with the composer idle",
    (state) => turnsFinished(state, turns),
    { timeoutMs: 180_000 },
  );
  await s.assertComposerUsable();
  await s.assertClean("after sending a second message during a run");
  await s.assertServerRunIdle(20_000);
  await s.assertThreadPersisted({
    minMessages: 4,
    answerTokens: [lineToken(first, LAST_LINE), second],
  });
}

export async function stopMidStream(s: ChatReliabilitySession): Promise<void> {
  const first = newNonce();
  const followUp = newNonce();
  await s.send(longAnswerPrompt(first), first);
  await s.waitUntil(
    "the answer to stream with a Stop button showing",
    (state) =>
      streaming(state, first) === null && state.stopVisible
        ? null
        : describeState(state),
    { timeoutMs: 60_000 },
  );
  await s.captureThreadId(first);

  const stoppedAt = Date.now();
  await s.stop();
  await s.waitForIdle(
    "the composer to return to idle within 15s of Stop",
    15_000,
  );
  s.annotate("timing", `idle ${Date.now() - stoppedAt}ms after Stop`);
  await s.assertServerRunIdle(20_000);
  await s.assertClean("after Stop");

  await s.send(exactReplyPrompt(followUp), followUp);
  await s.waitUntil(
    "a message sent after Stop to complete normally",
    (state) =>
      turnsFinished(state, [{ userToken: followUp, answerToken: followUp }]),
    { timeoutMs: 120_000 },
  );
  await s.assertComposerUsable();
  await s.assertClean("after sending a message following Stop");
  await s.assertServerRunIdle(20_000);
}

export async function multiTurnPersists(
  s: ChatReliabilitySession,
): Promise<void> {
  const first = newNonce();
  const second = newNonce();
  const turns: ExpectedTurn[] = [
    { userToken: first, answerToken: first },
    { userToken: second, answerToken: second },
  ];
  await s.send(exactReplyPrompt(first), first);
  await s.waitUntil(
    "the first turn to complete",
    (state) => turnsFinished(state, turns.slice(0, 1)),
    { timeoutMs: 120_000 },
  );
  await s.captureThreadId(first);
  await s.send(exactReplyPrompt(second), second);
  await s.waitUntil(
    "the second turn to complete",
    (state) => turnsFinished(state, turns),
    { timeoutMs: 120_000 },
  );
  await s.assertClean("after two turns");
  await s.assertServerRunIdle(20_000);
  await s.assertThreadPersisted({
    minMessages: 4,
    answerTokens: [first, second],
  });
  await s.assertThreadListed();
  const railChecked = await s.assertHistoryRailTitled();
  s.annotate(
    "history",
    railChecked
      ? "visible rail checked"
      : "no visible rail; stored list checked",
  );

  const link = s.threadLink();
  await s.reload();
  await s.waitUntil(
    "both turns to be restored in order after a reload",
    (state) => turnsFinished(state, turns),
    { timeoutMs: 60_000 },
  );

  await s.startNewChat();
  await s.waitUntil(
    "a new chat that does not show the previous thread",
    (state) =>
      state.messages.some(
        (message) =>
          message.text.includes(first) || message.text.includes(second),
      )
        ? `the new chat still shows the earlier turns: ${describeState(state)}`
        : null,
    { timeoutMs: 30_000 },
  );
  await s.goto(link);
  await s.waitUntil(
    "both turns to be restored after returning to the thread",
    (state) => turnsFinished(state, turns),
    { timeoutMs: 60_000 },
  );
  await s.assertClean("after leaving and returning to the thread");
}

export async function toolCallMutatesData(
  s: ChatReliabilitySession,
): Promise<void> {
  const nonce = newNonce();
  const probe = mutationProbe(s, nonce, RUN_ID);
  try {
    await s.send(probe.prompt, nonce);
    const finished = await s.waitUntil(
      "the tool-using turn to finish with an assistant answer",
      (state) =>
        assistantTextAfter(state.messages, nonce).trim() && isIdle(state)
          ? null
          : describeState(state),
      { timeoutMs: 150_000 },
    );
    await s.captureThreadId(nonce);
    const said = assistantTextAfter(finished.messages, nonce);

    let readBack: string | null = "never read";
    await s
      .pollUntil(`${probe.describes} to exist`, 20_000, async () => {
        readBack = await probe.readBack();
        return readBack;
      })
      .catch(() => undefined); // coercion-ok: readBack holds the outcome and is reported below.
    if (readBack !== null) {
      const claimed =
        said.includes(probe.answerToken) ||
        /\b(created|saved|wrote|written|done)\b/i.test(said);
      throw new Error(
        `the app has no ${probe.describes} after the turn finished. The assistant ${claimed ? "CLAIMED it was done" : "did not claim it was done"}: "${tail(said, 400)}". Independent read-back: ${readBack}`,
      );
    }

    const problems = checkTranscript(finished.messages, [
      {
        userToken: nonce,
        answerToken: probe.answerToken,
        allowRepeatedAnswer: true,
      },
    ]);
    if (problems.length > 0) {
      throw new Error(
        `${probe.describes} exists, but the turn did not end with the requested reply: ${problems.join("; ")}. Assistant said: "${tail(said, 400)}"`,
      );
    }
    await s.assertClean("after a tool-using turn");
    await s.assertServerRunIdle(20_000);
  } finally {
    const leftover = await probe.cleanup();
    if (leftover) {
      s.note(`cleanup of ${probe.describes} failed: ${leftover}`);
      s.annotate("cleanup-leftover", `${probe.describes}: ${leftover}`);
    }
  }
}
