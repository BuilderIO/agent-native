import { withoutWriteObservation } from "@agent-native/core/action";
import {
  decide,
  getDecisionsStatus,
  OPENAI_DECISIONS_MODEL,
} from "@agent-native/core/decisions";
import { completeText } from "@agent-native/core/server";
import { and, eq, lt, sql } from "drizzle-orm";

import {
  PAGE_CHECK_WRITER_PROMPT,
  pageCheckWriterInput,
  readWrittenPageCheckQuestions,
  type WrittenPageCheckQuestions,
} from "../../shared/page-check-questions.js";
import {
  PAGE_CHECK_DAILY_QUESTIONS,
  pageCheckDecisionRequest,
  pageCheckPartFinding,
  pageCheckPassing,
  type PageCheckCouldntReason,
  type PageCheckDecider,
  type PageCheckDeciderName,
  type PageCheckPart,
  type PageCheckPartResult,
  type PageCheckPlace,
  type PageCheckQuestionPart,
  type PageCheckSure,
} from "../../shared/page-checks.js";
import { getDb, schema } from "../db/index.js";
import { firstRow } from "./first-row.js";

const WRITER_TIMEOUT_MS = 20_000;
const QUESTION_TIMEOUT_MS = 10_000;
const ASK_AT_ONCE = 8;
export const PAGE_CHECK_RUN_BUDGET_MS = 15_000;

export const PAGE_CHECK_DECIDER_NAMES: Record<
  PageCheckDecider,
  { model: string; company: string }
> = {
  jev: { model: "Jev", company: "TypeSafe AI" },
  openai: { model: OPENAI_DECISIONS_MODEL, company: "OpenAI" },
};

export function pageCheckDeciderName(
  provider: PageCheckDecider,
): PageCheckDeciderName {
  return { provider, ...PAGE_CHECK_DECIDER_NAMES[provider] };
}

export async function writePageCheckQuestions(
  texts: readonly string[],
): Promise<WrittenPageCheckQuestions> {
  if (texts.length === 0) return { status: "ok", questions: [] };
  try {
    const reply = await completeText({
      systemPrompt: PAGE_CHECK_WRITER_PROMPT,
      input: pageCheckWriterInput(texts),
      temperature: 0,
      maxOutputTokens: 800,
      timeoutMs: WRITER_TIMEOUT_MS,
    });
    return readWrittenPageCheckQuestions(texts, reply.text);
  } catch (error) {
    console.warn("[page-checks] couldn't write questions", error);
    return { status: "unreadable" };
  }
}

export async function pageCheckDecider(
  ownerEmail: string,
  existing: PageCheckDecider | undefined,
): Promise<PageCheckDecider | null> {
  if (existing) return existing;
  try {
    const status = await getDecisionsStatus(ownerEmail);
    return (
      status.providerOrder.find((provider) =>
        status.providers.some(
          (entry) => entry.provider === provider && entry.status === "ready",
        ),
      ) ?? null
    );
  } catch (error) {
    console.warn("[page-checks] couldn't read decision models", error);
    return null;
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function clearOldPageCheckUsage(documentId: string) {
  const usage = schema.contentPageCheckUsage;
  await withoutWriteObservation(async () => {
    await getDb()
      .delete(usage)
      .where(and(eq(usage.documentId, documentId), lt(usage.day, today())));
  });
}

async function countQuestions(documentId: string, day: string, add: number) {
  const usage = schema.contentPageCheckUsage;
  const row = await withoutWriteObservation(async () =>
    firstRow(
      await getDb()
        .insert(usage)
        .values({ documentId, day, questions: add })
        .onConflictDoUpdate({
          target: [usage.documentId, usage.day],
          set: { questions: sql`${usage.questions} + ${add}` },
        })
        .returning({ questions: usage.questions }),
    ),
  );
  return row?.questions ?? 0;
}

async function askOnce(
  ownerEmail: string,
  provider: PageCheckDecider,
  questions: readonly { index: number; part: PageCheckQuestionPart }[],
  place: Pick<PageCheckPlace, "markdown">,
): Promise<
  | { status: "ok"; yes: Map<number, number>; judged: boolean }
  | { status: "couldnt"; reason: PageCheckCouldntReason }
> {
  try {
    const result = await decide({
      ownerEmail,
      ...pageCheckDecisionRequest(questions, place),
      options: {
        providers: [provider],
        timeoutMs: QUESTION_TIMEOUT_MS,
        cacheKey: "content-page-check",
      },
    });
    if (result.status === "not_configured") {
      return { status: "couldnt", reason: "no_model" };
    }
    if (result.status === "failed") {
      console.warn("[page-checks] no decision", result.reason);
      return { status: "couldnt", reason: "model_failed" };
    }
    const answers = new Map(Object.entries(result.answers));
    const yes = new Map<number, number>();
    for (const { index } of questions) {
      const answer = answers.get(`part_${index}`);
      if (answer?.type === "predicate") yes.set(index, answer.probability);
    }
    return { status: "ok", yes, judged: result.cached !== true };
  } catch (error) {
    console.warn("[page-checks] decision threw", error);
    return { status: "couldnt", reason: "model_failed" };
  }
}

export async function askPageCheckQuestions(input: {
  ownerEmail: string;
  documentId: string;
  parts: readonly PageCheckPart[];
  place: Pick<PageCheckPlace, "markdown">;
  sure: PageCheckSure;
}): Promise<Map<number, PageCheckPartResult>> {
  const asked = new Map<number, PageCheckPartResult>();
  const byDecider = new Map<
    PageCheckDecider,
    { index: number; part: PageCheckQuestionPart }[]
  >();
  for (const [index, part] of input.parts.entries()) {
    if (part.kind !== "question") continue;
    const questions = byDecider.get(part.decider) ?? [];
    questions.push({ index, part });
    byDecider.set(part.decider, questions);
  }
  const day = today();
  for (const [provider, questions] of byDecider) {
    const couldnt = (reason: PageCheckCouldntReason) => {
      for (const { index } of questions) {
        asked.set(index, { finding: "couldnt", reason });
      }
    };
    const count = questions.length;
    const total = await countQuestions(input.documentId, day, count);
    if (total > PAGE_CHECK_DAILY_QUESTIONS) {
      await countQuestions(input.documentId, day, -count);
      couldnt("daily_limit");
      continue;
    }
    const answer = await askOnce(
      input.ownerEmail,
      provider,
      questions,
      input.place,
    );
    if (answer.status === "couldnt" || !answer.judged) {
      await countQuestions(input.documentId, day, -count);
    }
    if (answer.status === "couldnt") {
      couldnt(answer.reason);
      continue;
    }
    for (const { index, part } of questions) {
      const yes = answer.yes.get(index);
      if (yes === undefined) {
        asked.set(index, { finding: "couldnt", reason: "model_failed" });
        continue;
      }
      const passing = pageCheckPassing(part, yes);
      asked.set(index, {
        finding: pageCheckPartFinding({ finding: "fine", passing }, input.sure),
        passing,
      });
    }
  }
  return asked;
}

export async function eachAtOnce<T>(
  items: readonly T[],
  deadline: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  const queue = items.values();
  const worker = async () => {
    for (;;) {
      if (Date.now() >= deadline) return;
      const next = queue.next();
      if (next.done) return;
      await work(next.value);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(ASK_AT_ONCE, items.length) }, worker),
  );
}
