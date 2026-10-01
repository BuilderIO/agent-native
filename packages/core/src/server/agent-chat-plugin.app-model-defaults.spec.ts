import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./agent-chat-plugin.ts", import.meta.url),
  "utf8",
);

const listRoute = source.slice(
  source.indexOf("const listModelDefaultEngineOptions"),
  source.indexOf("const buildModelDefaultsPayload"),
);
const putRouteStart = source.indexOf(
  'if (method !== "PUT" && method !== "DELETE")',
);
const putRoute = source.slice(
  putRouteStart,
  source.indexOf(
    "return buildModelDefaultsPayload(event, targetAppId);",
    putRouteStart,
  ),
);

describe("agent app model-default ChatGPT options", () => {
  it("hides the ChatGPT engine unless its user's lab is enabled", () => {
    expect(listRoute).toContain("getUserLabEnabled(");
    expect(listRoute).toContain("ctx.userEmail");
    expect(listRoute).toContain("CHATGPT_SUBSCRIPTION_LAB");
    expect(listRoute).toContain("chatGPTEnabled && ctx.userEmail");
    expect(listRoute).toContain("visibleEngines.map(async (entry) => ({");
  });

  it("offers the viewer's catalog models and hides ChatGPT without options", () => {
    expect(listRoute).toContain("requestOrigin: getOrigin(event)");
    expect(listRoute).toContain("isLoopbackRequest: isLoopbackRequest(event)");
    expect(listRoute).toContain("listChatGPTSubscriptionModels(ctx.userEmail)");
    expect(listRoute).toContain(
      "if (!chatGPTCatalog?.models.length) return [];",
    );
    expect(listRoute).toContain("supportedModels: chatGPTCatalog.models");
  });

  it("refuses a disabled ChatGPT lab before writing a default", () => {
    const labCheck = putRoute.indexOf("getUserLabEnabled(");
    const catalogCheck = putRoute.indexOf("listChatGPTSubscriptionModels(");
    const write = putRoute.indexOf("await writeAgentAppModelDefaultSettings(");

    expect(labCheck).toBeGreaterThanOrEqual(0);
    expect(putRoute).toContain("setResponseStatus(event, 403)");
    expect(putRoute).toContain(
      "Enable ChatGPT plan access in Settings → Labs first.",
    );
    expect(catalogCheck).toBeGreaterThan(labCheck);
    expect(write).toBeGreaterThan(catalogCheck);
  });

  it("checks ChatGPT models against the selected account's visible catalog", () => {
    expect(putRoute).toContain("requestOrigin: getOrigin(event)");
    expect(putRoute).toContain("isLoopbackRequest: isLoopbackRequest(event)");
    expect(putRoute).toContain("if (!catalog.models.includes(model))");
    expect(putRoute).toContain("setResponseStatus(event, 400)");
  });
});
