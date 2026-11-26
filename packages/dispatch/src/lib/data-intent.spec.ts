import { describe, expect, it } from "vitest";

import { classifyDataIntent } from "./data-intent.js";

describe("classifyDataIntent", () => {
  it.each([
    ["show me GitHub messages from actual people", "mail"],
    ["show emails about GitHub issues", "mail"],
    ["open my GitHub inbox", "mail"],
    ["find messages from people", "mail"],
    ["show my GitHub issues", "tasks"],
    ["open GitHub pull requests", "tasks"],
    ["list GitHub PRs assigned to me", "tasks"],
    ["show messages on GitHub pull request 12", "tasks"],
    ["list GitHub issues with the message mentioning timeout", "tasks"],
    ["what is on my calendar", null],
    ["show my pull requests", null],
  ])("classifies %s as %s", (text, app) => {
    expect(classifyDataIntent(text)).toBe(app);
  });
});
