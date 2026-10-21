import { describe, expect, it } from "vitest";

import { inlineDesignStylesheets } from "./linked-stylesheets";

const stylesheets = new Map([["theme.css", ".a{outline:2px solid #0ea5e9}"]]);

describe("inlineDesignStylesheets", () => {
  it("inlines a stylesheet link that names a design CSS file", () => {
    expect(
      inlineDesignStylesheets(
        '<head><link rel="stylesheet" href="./theme.css" /></head>',
        stylesheets,
      ),
    ).toBe(
      '<head><style data-agent-native-design-stylesheet="theme.css">.a{outline:2px solid #0ea5e9}</style></head>',
    );
  });

  it("leaves other links alone", () => {
    const html =
      '<link rel="stylesheet" href="https://cdn.example.com/x.css"><link rel="icon" href="theme.css">';
    expect(inlineDesignStylesheets(html, stylesheets)).toBe(html);
  });
});
