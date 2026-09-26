import type { ToolRendererProps } from "@agent-native/core/client/agentkit-chat";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MailDraftCreated } from "./register-mail-draft-card";

function renderCard(context: ToolRendererProps["context"]) {
  return renderToStaticMarkup(<MailDraftCreated context={context} />);
}

describe("MailDraftCreated", () => {
  it("shows a compact summary and opens the saved draft in Mail", () => {
    const html = renderCard({
      toolName: "manage-draft",
      args: {
        action: "create",
        to: "ana@example.test",
        subject: "Launch notes",
      },
      resultJson: {
        draft: { body: "private body" },
        deepLink:
          "/_agent-native/open?app=mail&view=inbox&composeDraftId=draft-1",
      },
      isRunning: false,
    });

    expect(html).toContain('class="flex min-w-0 items-center gap-3"');
    expect(html).toContain('class="grid size-9 shrink-0 place-items-center');
    expect(html).toContain(
      'class="truncate text-sm font-medium text-foreground"',
    );
    expect(html).toContain('class="truncate text-xs text-muted-foreground"');
    expect(html).toContain("Launch notes");
    expect(html).toContain("ana@example.test");
    expect(html).toContain("Open in Mail");
    expect(html).toContain('href="/_agent-native/open?app=mail');
    expect(html).not.toContain("private body");
  });

  it("hides the renderer for non-create operations and unsafe links", () => {
    expect(
      renderCard({
        toolName: "manage-draft",
        args: { action: "update", id: "draft-1" },
        resultJson: { deepLink: "javascript:alert(1)" },
        isRunning: false,
      }),
    ).toBe("");

    expect(
      renderCard({
        toolName: "manage-draft",
        args: { action: "create" },
        resultJson: {
          deepLink: "https://example.test/_agent-native/open?app=mail",
        },
        isRunning: false,
      }),
    ).toBe("");
  });

  it("accepts draft links behind a configured route prefix", () => {
    const html = renderCard({
      toolName: "manage-draft",
      args: { action: "create", subject: "Launch notes" },
      resultJson: {
        deepLink:
          "/workspace/_agent-native/open?app=mail&view=inbox&composeDraftId=draft-1",
      },
      isRunning: false,
    });

    expect(html).toContain("Open in Mail");
    expect(html).toContain('href="/workspace/_agent-native/open?app=mail');
  });
});
