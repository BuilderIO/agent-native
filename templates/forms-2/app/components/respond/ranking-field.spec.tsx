// @vitest-environment happy-dom

import { deriveQuestions, questionBlocks } from "@shared/form-model";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RankingField } from "./ranking-field";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

const question = deriveQuestions(
  questionBlocks({
    id: "q",
    type: "RANKING",
    title: "Rank",
    options: ["Alpha", "Beta", "Gamma"],
  }),
)[0];

afterEach(() => {
  document.body.innerHTML = "";
});

describe("RankingField keyboard", () => {
  it("moves a ranked option down one rank with the arrow key", () => {
    if (!question) throw new Error("no question");
    const [alpha, beta, gamma] = question.options.map((option) => option.id);
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    act(() =>
      createRoot(host).render(
        <RankingField
          question={question}
          value={{ selected: [alpha ?? "", beta ?? "", gamma ?? ""] }}
          onChange={onChange}
          onBlur={() => undefined}
          invalid={false}
        />,
      ),
    );
    const first = host.querySelector<HTMLButtonElement>("[role=checkbox]");
    act(() => {
      first?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(onChange).toHaveBeenCalledWith({
      selected: [beta, alpha, gamma],
    });
  });
});
