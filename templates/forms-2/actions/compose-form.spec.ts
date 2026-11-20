import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  blockListSchema,
  deriveQuestions,
  splitPages,
} from "../shared/form-model/index.js";
import { as, owner, startTestDb, stopTestDb } from "./_test-context.js";
import composeForm from "./compose-form.js";
import createForm from "./create-form.js";
import getForm from "./get-form.js";
import getPublicForm from "./get-public-form.js";
import publishForm from "./publish-form.js";
import saveDraft from "./save-form-draft.js";

const newForm = async () => (await as(owner, () => createForm.run({}))).id;
const compose = (
  id: string,
  items: Parameters<typeof composeForm.run>[0]["items"],
  mode: "append" | "replace" = "append",
  title?: string,
) =>
  as(owner, () =>
    composeForm.run({ id, items, mode, ...(title ? { title } : {}) }),
  );
const draftOf = async (id: string) =>
  (await as(owner, () => getForm.run({ id }))).draftBlocks!;

describe("compose-form", () => {
  beforeAll(startTestDb);
  afterAll(stopTestDb);

  it("produces a valid block list for every item kind", async () => {
    const id = await newForm();
    const types = [
      "short_answer",
      "long_answer",
      "email",
      "number",
      "phone",
      "link",
      "date",
      "time",
      "multiple_choice",
      "checkboxes",
      "dropdown",
      "multi_select",
      "rating",
      "linear_scale",
    ];
    const result = await compose(
      id,
      [
        { kind: "heading", level: 2, text: "Intro" },
        { kind: "text", text: "Hello" },
        { kind: "divider" },
        ...types.map((type) => ({
          kind: "question" as const,
          type,
          title: `Q ${type}`,
          options: ["A", "B"],
        })),
        { kind: "page_break" },
        {
          kind: "question",
          type: "short_answer",
          title: "Last",
        },
        {
          kind: "logic",
          when: { question: "Q multiple_choice", op: "is", value: "A" },
          then: { action: "jump_to_page", target: 2 },
        },
      ],
      "replace",
      "All kinds",
    );
    expect(result.saved).toBe(true);
    expect(result.pageCount).toBe(2);
    expect(result.questions).toHaveLength(15);
    const blocks = await draftOf(id);
    expect(blockListSchema.safeParse(blocks).success).toBe(true);
    expect(blocks[0]?.payload).toMatchObject({ text: "All kinds" });
    expect(blocks.some((b) => b.type === "CONDITIONAL_LOGIC")).toBe(true);
  });

  it("turns choice options into option blocks", async () => {
    const id = await newForm();
    await compose(id, [
      {
        kind: "question",
        type: "multiple_choice",
        title: "Dates",
        options: ["June 5-7", "June 12-14"],
        required: true,
      },
    ]);
    const blocks = await draftOf(id);
    const options = blocks.filter((b) => b.type === "MULTIPLE_CHOICE_OPTION");
    expect(options.map((b) => (b.payload as { text: string }).text)).toEqual([
      "June 5-7",
      "June 12-14",
    ]);
    expect(deriveQuestions(blocks)[0]).toMatchObject({
      title: "Dates",
      isRequired: true,
    });
  });

  it("fills an empty title from a renamed form", async () => {
    const { id } = await as(owner, () => createForm.run({ name: "Offsite" }));
    await compose(id, [{ kind: "text", text: "Hi" }]);
    expect((await draftOf(id))[0]?.payload).toMatchObject({ text: "Offsite" });
  });

  it("rejects a choice question without options", async () => {
    const id = await newForm();
    await expect(
      compose(id, [{ kind: "question", type: "dropdown", title: "Pick" }]),
    ).rejects.toThrow(/needs options/);
  });

  it("appends after existing content and replaces on request", async () => {
    const id = await newForm();
    await compose(id, [
      { kind: "question", type: "short_answer", title: "One" },
    ]);
    await compose(id, [{ kind: "question", type: "email", title: "Two" }]);
    expect(deriveQuestions(await draftOf(id)).map((q) => q.title)).toEqual([
      "One",
      "Two",
    ]);
    await compose(
      id,
      [{ kind: "question", type: "email", title: "Three" }],
      "replace",
    );
    expect(deriveQuestions(await draftOf(id)).map((q) => q.title)).toEqual([
      "Three",
    ]);
  });

  it("appends before an existing thank-you page", async () => {
    const id = await newForm();
    await compose(id, [
      { kind: "question", type: "short_answer", title: "One" },
    ]);
    const blocks = await draftOf(id);
    await as(owner, () =>
      saveDraft.run({
        id,
        blocks: [
          ...blocks,
          {
            uuid: "ty",
            type: "THANK_YOU_PAGE",
            groupUuid: "ty",
            groupType: "THANK_YOU_PAGE",
            payload: {},
          },
        ],
      }),
    );
    await compose(id, [{ kind: "question", type: "email", title: "Two" }]);
    const after = await draftOf(id);
    expect(after.at(-1)?.type).toBe("THANK_YOU_PAGE");
    expect(deriveQuestions(after).map((q) => q.title)).toEqual(["One", "Two"]);
  });

  it("serves a composed multi-page form through get-public-form once published", async () => {
    const id = await newForm();
    await compose(
      id,
      [
        {
          kind: "question",
          type: "short_answer",
          title: "Name",
          required: true,
        },
        { kind: "page_break" },
        { kind: "question", type: "rating", title: "Rate last offsite" },
      ],
      "replace",
      "Barcelona Offsite",
    );
    await as(owner, () => publishForm.run({ id }));
    const open = await getPublicForm.run({ formId: id });
    if (open.state !== "open") throw new Error("expected an open form");
    const pages = splitPages(open.form.blocks).map((page) =>
      deriveQuestions(page.blocks).map((q) => q.title),
    );
    expect(pages).toEqual([["Name"], ["Rate last offsite"]]);
  });

  it("still requires text on text blocks, and the error points to compose-form", () => {
    const result = blockListSchema.safeParse([
      {
        uuid: "a",
        type: "TITLE",
        groupUuid: "a",
        groupType: "QUESTION",
        payload: {},
      },
    ]);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("compose-form");
  });

  it("builds hidden and calculated fields with a calculate rule", async () => {
    const id = await newForm();
    await compose(id, [
      { kind: "hidden_field", names: ["ref"] },
      { kind: "calculated_field", name: "score", type: "number" },
      {
        kind: "question",
        type: "multiple_choice",
        title: "Fruit",
        options: ["Apple", "Banana"],
      },
      {
        kind: "logic",
        when: { question: "Fruit", op: "is", value: "Apple" },
        then: {
          action: "calculate",
          field: "score",
          operator: "add",
          operand: 10,
        },
      },
    ]);
    const blocks = await draftOf(id);
    expect(blockListSchema.safeParse(blocks).success).toBe(true);
    expect(deriveQuestions(blocks).map((q) => [q.title, q.type])).toEqual([
      ["ref", "HIDDEN_FIELD"],
      ["score", "CALCULATED_FIELD"],
      ["Fruit", "MULTIPLE_CHOICE"],
    ]);
  });
});
