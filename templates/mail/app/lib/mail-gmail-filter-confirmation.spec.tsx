import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import manageGmailFilters from "../../actions/manage-gmail-filters";
import { i18nCatalog } from "../i18n";
import { MailGmailFilterConfirmation } from "./mail-gmail-filter-confirmation";

const result = {
  ok: true,
  message: "Created Gmail filter filter-1 in owner@example.com.",
  accountEmail: "owner@example.com",
  filter: {
    id: "filter-1",
    criteriaSummary: "from bots@example.com",
    actionSummary: "Archive",
  },
};

function render(operation: string, resultJson: unknown) {
  return renderToStaticMarkup(
    <AgentNativeI18nProvider
      catalog={i18nCatalog}
      initialLocale="en-US"
      persistPreference={false}
    >
      <MailGmailFilterConfirmation
        context={{
          toolName: "manage-gmail-filters",
          args: { operation },
          resultText: undefined,
          resultJson,
          isRunning: false,
        }}
      />
    </AgentNativeI18nProvider>,
  );
}

describe("Mail Gmail filter chat widget", () => {
  it("renders the created rule, precise confirmation, and Gmail Filters link", () => {
    const html = render("create", result);

    expect(html).toContain('class="flex min-w-0 items-center gap-3"');
    expect(html).toContain('class="grid size-9 shrink-0 place-items-center');
    expect(html).toContain(
      'class="truncate text-sm font-medium text-foreground"',
    );
    expect(html).toContain('class="truncate text-xs text-muted-foreground"');
    expect(html).toContain("from bots@example.com");
    expect(html).toContain("Archive");
    expect(html).toContain(result.message);
    expect(html).toContain("Gmail Filters");
    expect(html).toContain(
      "https://mail.google.com/mail/?authuser=owner%40example.com#settings/filters",
    );
    expect(html).not.toContain("Toggle");
    expect(html).not.toContain("Undo");
  });

  it("confirms replacement with the new filter and has no toggle control", () => {
    const html = render("replace", {
      ...result,
      message:
        "Replaced Gmail filter filter-old with filter-1 in owner@example.com.",
    });

    expect(html).toContain(
      "Replaced Gmail filter filter-old with filter-1 in owner@example.com.",
    );
    expect(html).toContain("Gmail Filters");
    expect(html).not.toContain("Toggle");
  });

  it("does not render for non-create operations, failures, or incomplete results", () => {
    expect(render("delete", result)).toBe("");
    expect(render("create", { ...result, ok: false })).toBe("");
    expect(render("create", { ...result, filter: undefined })).toBe("");
  });

  it("declares the renderer on the Gmail filters action", () => {
    expect(manageGmailFilters.chatUI).toMatchObject({
      renderer: "mail.gmail-filter-confirmation",
      when: expect.any(Function),
    });
  });
});
