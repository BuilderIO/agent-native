import { deriveQuestions } from "@shared/form-model";
import { describe, expect, it } from "vitest";

import {
  ImportError,
  importKindOf,
  inferType,
  parseImportText,
} from "./import-parse";

const questionsOf = (name: string, source: string) =>
  deriveQuestions(parseImportText(name, source).blocks).map((q) => [
    q.type,
    q.title,
    q.options.map((o) => o.text),
    q.isRequired,
  ]);

describe("import parsing", () => {
  it("reads a CSV with a header row", () => {
    const csv =
      'Question,Type,Options,Required\n"Your name, please",short answer,,yes\nPick one,multiple choice,Red|Blue,\n';
    expect(questionsOf("form.csv", csv)).toEqual([
      ["INPUT_TEXT", "Your name, please", [], true],
      ["MULTIPLE_CHOICE", "Pick one", ["Red", "Blue"], false],
    ]);
  });

  it("reads a CSV without a header as one question per row", () => {
    expect(
      questionsOf("q.csv", "Email address\nFavourite colour,Red;Green\n"),
    ).toEqual([
      ["INPUT_EMAIL", "Email address", [], false],
      ["MULTIPLE_CHOICE", "Favourite colour", ["Red", "Green"], false],
    ]);
  });

  it("reads Markdown: title, list items as options, trailing star as required", () => {
    const md =
      "# Pet survey\n\nWhat is your pet's name? *\nWhich pet do you have?\n- Dog\n- Cat\n";
    const parsed = parseImportText("pets.md", md);
    expect(parsed.title).toBe("Pet survey");
    expect(questionsOf("pets.md", md)).toEqual([
      ["INPUT_TEXT", "What is your pet's name?", [], true],
      ["MULTIPLE_CHOICE", "Which pet do you have?", ["Dog", "Cat"], false],
    ]);
  });

  it("reads our own JSON shapes", () => {
    const json = JSON.stringify({
      title: "T",
      questions: [{ title: "Rate us", type: "rating" }, "Phone number"],
    });
    expect(questionsOf("f.json", json).map((q) => q[0])).toEqual([
      "RATING",
      "INPUT_PHONE_NUMBER",
    ]);
  });

  it("fails loudly on unreadable and empty files", () => {
    expect(() => parseImportText("f.json", "{nope")).toThrow(ImportError);
    expect(() => parseImportText("f.txt", "   \n\n")).toThrow(ImportError);
    expect(() => parseImportText("f.txt", "a\u0000b")).toThrow(ImportError);
  });

  it("sends PDF, Word and images to the agent and rejects other files", () => {
    expect(importKindOf("a.pdf", "")).toBe("agent");
    expect(importKindOf("a.docx", "")).toBe("agent");
    expect(importKindOf("a.png", "image/png")).toBe("agent");
    expect(importKindOf("a.csv", "")).toBe("text");
    expect(importKindOf("a.zip", "application/zip")).toBeNull();
  });

  it("infers a type from the title", () => {
    expect(inferType("Your work email", [])).toBe("INPUT_EMAIL");
    expect(inferType("Anything else?", [])).toBe("INPUT_TEXT");
  });
});
