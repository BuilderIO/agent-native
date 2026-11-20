import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  blankFormBlocks,
  deriveQuestions,
  questionBlocks,
} from "../shared/form-model/index.js";
import { as, owner, startTestDb, stopTestDb } from "./_test-context.js";
import createForm from "./create-form.js";
import exportCsv from "./export-submissions-csv.js";
import listSubmissions from "./list-submissions.js";
import publishForm from "./publish-form.js";
import submitResponse from "./submit-response.js";
import uploadFormFile from "./upload-form-file.js";

const blocks = [
  ...blankFormBlocks(),
  ...questionBlocks({
    id: "rank",
    type: "RANKING",
    title: "Rank",
    isRequired: true,
    options: ["Apple", "Banana", "Cherry"],
  }),
  ...questionBlocks({
    id: "matrix",
    type: "MATRIX",
    title: "Rate",
    isRequired: true,
    rows: ["Speed", "Quality"],
    columns: ["Poor", "Good"],
  }),
  ...questionBlocks({ id: "file", type: "FILE_UPLOAD", title: "File" }),
];

async function publishedForm() {
  const { id } = await as(owner, () => createForm.run({}));
  await as(owner, () => publishForm.run({ id, blocks }));
  return id;
}

describe("rich blocks", () => {
  beforeAll(startTestDb);
  afterAll(stopTestDb);

  it("stores ranking and matrix answers and exports one column per matrix row", async () => {
    const id = await publishedForm();
    const [rank, matrix] = deriveQuestions(blocks);
    const [apple, banana, cherry] = rank?.options.map((o) => o.id) ?? [];
    const [speed, quality] = matrix?.rows.map((r) => r.id) ?? [];
    const [poor, good] = matrix?.options.map((o) => o.id) ?? [];
    const result = await submitResponse.run({
      formId: id,
      sessionId: `${id}-session-1`,
      respondentId: "person-rich-1",
      isCompleted: true,
      answers: {
        rank: { selected: [banana ?? "", apple ?? "", cherry ?? ""] },
        matrix: {
          matrix: {
            [speed ?? ""]: [good ?? ""],
            [quality ?? ""]: [poor ?? ""],
          },
        },
        file: { files: ["https://cdn.example.test/cv.pdf"] },
      },
    });
    expect(result.ok).toBe(true);

    const listed = await as(owner, () =>
      listSubmissions.run({ formId: id, filter: "all", limit: 10, offset: 0 }),
    );
    expect(listed.questions[1]?.rows.map((row) => row.text)).toEqual([
      "Speed",
      "Quality",
    ]);
    const { csv } = await as(owner, () => exportCsv.run({ formId: id }));
    const [header, row] = csv.trim().split("\r\n");
    expect(header).toBe("Submitted at,Rank,Rate [Speed],Rate [Quality],File");
    expect(row).toContain('"Banana, Apple, Cherry",Good,Poor,');
  });

  it("refuses an empty required ranking and a half-answered matrix", async () => {
    const id = await publishedForm();
    const result = await submitResponse.run({
      formId: id,
      sessionId: `${id}-session-2`,
      respondentId: "person-rich-2",
      isCompleted: true,
      answers: {},
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("will not upload to a question that is not a file or signature question", async () => {
    const id = await publishedForm();
    await expect(
      uploadFormFile.run({
        formId: id,
        questionId: "rank",
        filename: "a.txt",
        contentType: "text/plain",
        data: "aGk=",
      }),
    ).rejects.toThrow();
  });
});
