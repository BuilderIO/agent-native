import { describe, expect, it } from "vitest";

import { isCreateLocalAppPrompt } from "./local-app-intent";

describe("isCreateLocalAppPrompt", () => {
  it.each([
    "make me a new app that tells me the weather",
    "Make me a new app that tells me the weather and looks like a phone weather app",
    "build an app to track my reading list",
    "Create a simple todo app",
    "can you make me an app that shows the moon phase",
    "please build me a habit tracker app",
    "I want you to create a new web app for splitting bills",
    "let's build a recipe app",
    "spin up a tiny app that converts units",
    "make a minimalist-style timer app",
  ])("treats %j as a new app request", (prompt) => {
    expect(isCreateLocalAppPrompt(prompt)).toBe(true);
  });

  it.each([
    "make the temperatures bigger",
    "fix the login bug in this app",
    "make this app faster",
    "why does the app crash on start?",
    "build the project and run the tests",
    "create a PR for the app store listing",
    "update the app icon",
    "make the existing app use dark mode",
    "what app should I build?",
    "",
  ])("leaves %j as a normal chat", (prompt) => {
    expect(isCreateLocalAppPrompt(prompt)).toBe(false);
  });
});
