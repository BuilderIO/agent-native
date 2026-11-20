import { describe, expect, it } from "vitest";

import {
  answerColumns,
  answerToText,
  blankFormBlocks,
  columnCellText,
  deriveQuestions,
  moveRank,
  moveRankTo,
  pickMatrixCell,
  questionBlocks,
  resolveEmbed,
  safeMediaUrl,
  toggleRank,
  validateSubmission,
  type Answers,
  type QuestionSpec,
} from "./index.js";

function check(spec: QuestionSpec, answers: Answers) {
  const blocks = [...blankFormBlocks(), ...questionBlocks(spec)];
  const question = deriveQuestions(blocks)[0];
  const errors = validateSubmission(blocks, answers).errors.map(
    (error) => error.code,
  );
  return { question, errors, blocks };
}

const rank = (): QuestionSpec => ({
  id: "q",
  type: "RANKING",
  title: "Rank",
  isRequired: true,
  options: ["A", "B", "C"],
});
const matrix = (allowMultiple = false): QuestionSpec => ({
  id: "q",
  type: "MATRIX",
  title: "Rate",
  isRequired: true,
  rows: ["Speed", "Quality"],
  columns: ["Poor", "Good"],
  settings: { allowMultiple },
});

describe("ranking helpers", () => {
  const all = ["a", "b", "c"];
  it("ranks in click order and fills the last option by itself", () => {
    const first = toggleRank([], all, "b");
    expect(first).toEqual(["b"]);
    expect(toggleRank(first, all, "a")).toEqual(["b", "a", "c"]);
  });
  it("unranks an option that is clicked again", () => {
    expect(toggleRank(["b", "a", "c"], all, "a")).toEqual(["b", "c"]);
  });
  it("moves a ranked option with the keyboard and stays inside the list", () => {
    expect(moveRank(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
    expect(moveRank(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
  });
  it("moves a dragged option to the rank of the one it drops on", () => {
    expect(moveRankTo(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveRankTo(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
  });
});

describe("matrix helpers", () => {
  it("replaces the pick in a single-choice row", () => {
    const one = pickMatrixCell(null, "r1", "good", false);
    expect(pickMatrixCell(one, "r1", "great", false).matrix).toEqual({
      r1: ["great"],
    });
  });
  it("toggles picks in a multiple-choice row", () => {
    const one = pickMatrixCell(null, "r1", "good", true);
    const two = pickMatrixCell(one, "r1", "great", true);
    expect(two.matrix.r1).toEqual(["good", "great"]);
    expect(pickMatrixCell(two, "r1", "good", true).matrix.r1).toEqual([
      "great",
    ]);
  });
});

describe("ranking answers", () => {
  it("require every option to be ranked", () => {
    const { question } = check(rank(), {});
    const [a, b, c] = question?.options.map((option) => option.id) ?? [];
    expect(check(rank(), {}).errors).toEqual(["required"]);
    expect(check(rank(), { q: { selected: [b ?? ""] } }).errors).toEqual([
      "ranking",
    ]);
    expect(
      check(rank(), { q: { selected: [b ?? "", a ?? "", c ?? ""] } }).errors,
    ).toEqual([]);
  });
  it("read back in rank order", () => {
    const { question } = check(rank(), {});
    const [a, b, c] = question?.options.map((option) => option.id) ?? [];
    expect(
      answerToText(question ?? ({} as never), {
        selected: [b ?? "", a ?? "", c ?? ""],
      }),
    ).toBe("B, A, C");
  });
  it("refuse ids that are not options", () => {
    expect(check(rank(), { q: { selected: ["x", "y", "z"] } }).errors).toEqual([
      "invalid_value",
    ]);
  });
});

describe("matrix answers", () => {
  const ids = () => {
    const { question } = check(matrix(), {});
    return {
      rows: question?.rows.map((row) => row.id) ?? [],
      columns: question?.options.map((column) => column.id) ?? [],
    };
  };
  it("need an answer in every row when required", () => {
    const { rows, columns } = ids();
    expect(check(matrix(), {}).errors).toEqual(["required"]);
    expect(
      check(matrix(), {
        q: { matrix: { [rows[0] ?? ""]: [columns[1] ?? ""] } },
      }).errors,
    ).toEqual(["matrix"]);
    expect(
      check(matrix(), {
        q: {
          matrix: {
            [rows[0] ?? ""]: [columns[1] ?? ""],
            [rows[1] ?? ""]: [columns[0] ?? ""],
          },
        },
      }).errors,
    ).toEqual([]);
  });
  it("allow two picks in a row only when multiple selection is on", () => {
    const { rows, columns } = ids();
    const answer = {
      q: {
        matrix: {
          [rows[0] ?? ""]: [columns[0] ?? "", columns[1] ?? ""],
          [rows[1] ?? ""]: [columns[0] ?? ""],
        },
      },
    };
    expect(check(matrix(false), answer).errors).toEqual(["matrix"]);
    expect(check(matrix(true), answer).errors).toEqual([]);
  });
  it("get one column per row, headed with the row text", () => {
    const { question } = check(matrix(), {});
    if (!question) throw new Error("no question");
    const columns = answerColumns([question]);
    expect(columns.map((column) => column.header)).toEqual([
      "Rate [Speed]",
      "Rate [Quality]",
    ]);
    const answer = {
      matrix: { [question.rows[1]?.id ?? ""]: [question.options[1]?.id ?? ""] },
    };
    expect(columns.map((column) => columnCellText(column, answer))).toEqual([
      "",
      "Good",
    ]);
  });
});

describe("file and signature answers", () => {
  const file: QuestionSpec = { id: "q", type: "FILE_UPLOAD", title: "File" };
  it("accept hosted links and refuse anything else", () => {
    expect(
      check(file, { q: { files: ["https://cdn.example.test/a.pdf"] } }).errors,
    ).toEqual([]);
    expect(
      check(file, { q: { files: ["data:text/plain;base64,AAAA"] } }).errors,
    ).toEqual(["file"]);
  });
  it("accept one file unless several are allowed", () => {
    const two = {
      q: {
        files: ["https://cdn.example.test/a", "https://cdn.example.test/b"],
      },
    };
    expect(check(file, two).errors).toEqual(["file"]);
    expect(
      check({ ...file, settings: { allowMultiple: true } }, two).errors,
    ).toEqual([]);
  });
  it("require a signature image link when required", () => {
    const signature: QuestionSpec = {
      id: "q",
      type: "SIGNATURE",
      title: "Sign",
      isRequired: true,
    };
    expect(check(signature, {}).errors).toEqual(["required"]);
    expect(check(signature, { q: "not a link" }).errors).toEqual(["signature"]);
    expect(
      check(signature, { q: "https://cdn.example.test/sig.png" }).errors,
    ).toEqual([]);
  });
});

describe("embeds", () => {
  it("turns provider links into player addresses", () => {
    expect(resolveEmbed("EMBED_VIDEO", "https://vimeo.com/76979871")?.src).toBe(
      "https://player.vimeo.com/video/76979871",
    );
    expect(
      resolveEmbed("EMBED_VIDEO", "https://www.youtube.com/watch?v=abc123")
        ?.src,
    ).toBe("https://www.youtube-nocookie.com/embed/abc123");
    expect(
      resolveEmbed("EMBED_AUDIO", "https://open.spotify.com/track/xyz")?.src,
    ).toBe("https://open.spotify.com/embed/track/xyz");
    expect(
      resolveEmbed("EMBED_MAP", "https://www.google.com/maps?q=Paris")?.src,
    ).toBe("https://www.google.com/maps?q=Paris&output=embed");
  });
  it("refuses providers outside the allowlist and non-http links", () => {
    expect(
      resolveEmbed("EMBED_VIDEO", "https://evil.example.test/v/1"),
    ).toBeNull();
    expect(resolveEmbed("EMBED_VIDEO", "javascript:alert(1)")).toBeNull();
    expect(resolveEmbed("EMBED_LINK", "javascript:alert(1)")).toBeNull();
    expect(resolveEmbed("EMBED_LINK", "https://example.test/page")).toEqual({
      src: "https://example.test/page",
      trusted: false,
    });
  });
  it("only lets http, https and site-relative links through for images", () => {
    expect(safeMediaUrl("/fixture-image.png")).toBe("/fixture-image.png");
    expect(safeMediaUrl("//evil.example.test/x.png")).toBeNull();
    expect(safeMediaUrl("data:image/png;base64,AAAA")).toBeNull();
  });
});
