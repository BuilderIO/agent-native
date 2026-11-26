import { describe, expect, it } from "vitest";

import createContentWebhook from "./create-content-webhook.js";
import deleteContentWebhook from "./delete-content-webhook.js";

// A webhook carries a signing secret and sends the owner's content elsewhere,
// so a full-app panel hands it to a signed-in browser.
const actions = [
  ["create-content-webhook", createContentWebhook],
  ["delete-content-webhook", deleteContentWebhook],
] as const;

describe("actions that need a signed-in browser", () => {
  it.each(actions)("%s refuses full-app panels", (_name, action) => {
    expect(action.requiresSignedInBrowser).toBe(true);
  });
});
