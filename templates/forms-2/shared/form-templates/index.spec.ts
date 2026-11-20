import { describe, expect, it } from "vitest";

import {
  blockListSchema,
  deriveQuestions,
  resolveNextStep,
  splitPages,
} from "../form-model/index";
import { TEMPLATE_IDS, buildTemplate } from "./index";

describe("form templates", () => {
  it.each(TEMPLATE_IDS)("%s is a valid block list with questions", (id) => {
    const blocks = buildTemplate(id);
    expect(blockListSchema.safeParse(blocks).success).toBe(true);
    expect(blocks[0]?.type).toBe("FORM_TITLE");
    expect(deriveQuestions(blocks).length).toBeGreaterThanOrEqual(3);
  });

  it("has a contact form with an email question", () => {
    const types = deriveQuestions(buildTemplate("contact-form")).map(
      (q) => q.type,
    );
    expect(types).toContain("INPUT_EMAIL");
  });

  it("routes each personality answer to its own result page", () => {
    const blocks = buildTemplate("personality-quiz");
    const pages = splitPages(blocks);
    const settle = deriveQuestions(blocks).find((q) =>
      q.title.startsWith("Pick the afternoon"),
    );
    const [quiet, market, trail] = settle?.options ?? [];
    if (!settle || !quiet || !market || !trail) throw new Error("no question");
    const from = (optionId: string) =>
      resolveNextStep(pages, 1, { [settle.id]: { selected: [optionId] } });
    expect(from(quiet.id)).toEqual({ kind: "page", page: 2 });
    expect(from(market.id)).toEqual({ kind: "page", page: 3 });
    expect(from(trail.id)).toEqual({ kind: "page", page: 4 });
    const answers = { [settle.id]: { selected: [market.id] } };
    expect(resolveNextStep(pages, 3, answers)).toEqual({ kind: "end" });
  });
});
