import { describe, expect, it } from "vitest";

import { answerToText, fileAnswerName } from "./answers.js";
import type { DerivedQuestion } from "./types.js";

const question = { options: [], rows: [] } as unknown as DerivedQuestion;

const uploaded = {
  files: [
    "https://cdn.example.test/assets/space/6c3a6740652e47e9ab79a2db5371d3fe",
    "https://cdn.example.test/assets/space/9f1d",
  ],
  names: ["QA-pretest-named.txt", "second.pdf"],
};

describe("file answers keep the chosen file's name", () => {
  it("names each uploaded file", () => {
    expect(fileAnswerName(uploaded, 0)).toBe("QA-pretest-named.txt");
    expect(answerToText(question, uploaded)).toBe(
      "QA-pretest-named.txt, second.pdf",
    );
  });

  it("falls back to the URL's last segment for answers stored before names", () => {
    const stored = { files: uploaded.files };
    expect(fileAnswerName(stored, 0)).toBe("6c3a6740652e47e9ab79a2db5371d3fe");
    expect(answerToText(question, stored)).toBe(
      "6c3a6740652e47e9ab79a2db5371d3fe, 9f1d",
    );
  });

  it("survives a names list shorter than the files list", () => {
    const partial = { files: uploaded.files, names: ["only.txt"] };
    expect(fileAnswerName(partial, 0)).toBe("only.txt");
    expect(fileAnswerName(partial, 1)).toBe("9f1d");
  });
});
