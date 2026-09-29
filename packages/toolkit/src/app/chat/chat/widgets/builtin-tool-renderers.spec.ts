import { describe, expect, it } from "vitest";

import type { ToolRendererContext } from "../tool-render-registry.js";
import {
  normalizeBuiltinActionChangeResult,
  resolveBuiltinActionChatRenderer,
} from "./builtin-tool-renderers.js";

const legacyResults: Array<{
  name: string;
  context: ToolRendererContext;
  title: string;
  detail: string;
  href?: string;
}> = [
  {
    name: "Mail AI filter results",
    context: {
      toolName: "apply-ai-filter",
      args: { mode: "filter" },
      resultJson: { changed: 2 },
      isRunning: false,
      chatUI: { renderer: "mail.ai-filter-confirmation" },
    },
    title: "Filtered email",
    detail: "2",
  },
  {
    name: "Mail draft results",
    context: {
      toolName: "manage-draft",
      args: { action: "create" },
      resultJson: {
        draft: { subject: "Launch notes", to: "ana@example.test" },
        deepLink: "/_agent-native/open?app=mail&composeDraftId=draft-1",
      },
      isRunning: false,
      chatUI: { renderer: "mail.draft-created" },
    },
    title: "Launch notes",
    detail: "ana@example.test",
    href: "/_agent-native/open?app=mail&composeDraftId=draft-1",
  },
  {
    name: "Gmail filter results",
    context: {
      toolName: "manage-gmail-filters",
      args: { operation: "create" },
      resultJson: {
        ok: true,
        message: "Created Gmail filter filter-1 in ana@example.test.",
        accountEmail: "ana@example.test",
        filter: {
          id: "filter-1",
          criteriaSummary: "From: updates@example.test",
          actionSummary: "Archive messages",
        },
      },
      isRunning: false,
      chatUI: { renderer: "mail.gmail-filter-confirmation" },
    },
    title: "From: updates@example.test",
    detail: "Archive messages",
    href: "https://mail.google.com/mail/?authuser=ana%40example.test#settings/filters",
  },
  {
    name: "Calendar event results",
    context: {
      toolName: "create-event",
      args: {},
      resultJson: {
        id: "google-event-1",
        title: "Planning day",
        start: "2026-09-28T09:00:00-07:00",
        end: "2026-09-28T10:00:00-07:00",
        location: "Room 4",
      },
      isRunning: false,
      chatUI: { renderer: "calendar.event-created" },
    },
    title: "Planning day",
    detail: "2026-09-28T09:00:00-07:00",
    href: "eventId=google-event-1",
  },
];

describe("legacy action chat renderers", () => {
  it.each(legacyResults)(
    "normalizes $name from its saved result",
    ({ context, title, detail, href }) => {
      expect(resolveBuiltinActionChatRenderer(context)).not.toBeNull();
      const normalized = normalizeBuiltinActionChangeResult(context);
      expect(normalized?.change.title).toBe(title);
      expect(normalized?.change.detail).toContain(detail);
      if (href) expect(normalized?.change.url).toContain(href);
    },
  );

  it("ignores malformed legacy results", () => {
    const context: ToolRendererContext = {
      toolName: "apply-ai-filter",
      args: { mode: "filter" },
      resultJson: { changed: "many" },
      isRunning: false,
      chatUI: { renderer: "mail.ai-filter-confirmation" },
    };
    expect(resolveBuiltinActionChatRenderer(context)).toBeNull();
    expect(normalizeBuiltinActionChangeResult(context)).toBeNull();
  });
});
