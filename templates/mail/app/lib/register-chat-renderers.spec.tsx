import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { i18nCatalog } from "../i18n";
import { MailAiFilterConfirmation } from "./register-chat-renderers";

function render(mode: string, result: unknown) {
  return renderToStaticMarkup(
    <AgentNativeI18nProvider
      catalog={i18nCatalog}
      initialLocale="en-US"
      persistPreference={false}
    >
      <MailAiFilterConfirmation
        context={{
          toolName: "apply-ai-filter",
          args: { mode },
          resultText: undefined,
          resultJson: result,
          isRunning: false,
        }}
      />
    </AgentNativeI18nProvider>,
  );
}

describe("Mail AI filter chat widget", () => {
  it("confirms archived message count without rendering private message details", () => {
    const html = render("filter", {
      changed: 2,
      state: { lastMatches: [{ subject: "Private subject" }] },
    });

    expect(html).toContain("Filtered 2 conversation(s).");
    expect(html).not.toContain("Private subject");
  });

  it("confirms messages kept in Inbox", () => {
    expect(render("keep", { changed: 1 })).toContain(
      "Kept 1 conversation(s) in Inbox.",
    );
  });

  it("does not show a result card for settings or no-op results", () => {
    expect(render("settings", { changed: 0 })).toBe("");
  });
});
