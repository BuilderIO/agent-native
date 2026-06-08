import { describe, expect, it } from "vitest";
import type { BlockAttrReader } from "@agent-native/core/blocks/server";
import {
  questionFormMdx,
  questionFormSchema,
  type QuestionFormData,
} from "./question-form.config.js";

function reader(attrs: Record<string, unknown>): BlockAttrReader {
  const read = (name: string) => attrs[name];
  return {
    raw: read,
    string: (name) =>
      typeof read(name) === "string" ? (read(name) as string) : undefined,
    number: (name) =>
      typeof read(name) === "number" ? (read(name) as number) : undefined,
    bool: (name) =>
      typeof read(name) === "boolean" ? (read(name) as boolean) : undefined,
    array: <T = unknown>(name: string) =>
      Array.isArray(read(name)) ? (read(name) as T[]) : undefined,
    object: <T = unknown>(name: string) => {
      const value = read(name);
      return value && typeof value === "object" ? (value as T) : undefined;
    },
  };
}

function roundTrip(data: QuestionFormData): QuestionFormData {
  const attrs = questionFormMdx.toAttrs(data) as Record<string, unknown>;
  return questionFormMdx.fromAttrs(reader(attrs), "");
}

describe("question-form block config", () => {
  const data: QuestionFormData = {
    submitLabel: "Send answers",
    questions: [
      {
        id: "q1",
        title: "Which path should we optimize?",
        subtitle: "Pick all that apply.",
        mode: "multi",
        allowOther: true,
        placeholder: "Describe another path...",
        required: true,
        options: [
          {
            id: "api",
            label: "API-first",
            detail: "Document endpoints before UI work.",
            recommended: true,
          },
        ],
      },
    ],
  };

  it("parses reusable question form data", () => {
    expect(questionFormSchema.parse(data)).toEqual(data);
  });

  it("uses the stable QuestionForm MDX tag", () => {
    expect(questionFormMdx.tag).toBe("QuestionForm");
  });

  it("round-trips questions and submit label through toAttrs/fromAttrs", () => {
    expect(roundTrip(data)).toEqual(data);
  });

  it("decodes missing questions to an empty array for partial MDX", () => {
    expect(questionFormMdx.fromAttrs(reader({}), "")).toEqual({
      questions: [],
      submitLabel: undefined,
    });
  });
});
