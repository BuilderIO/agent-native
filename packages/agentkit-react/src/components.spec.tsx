import { readFileSync } from "node:fs";

import { AgentKitClient } from "@agent-native/agentkit-client";
import type { AgentTransport } from "@agent-native/agentkit-protocol";
import type { PromptComposerProps } from "@agent-native/toolkit/composer/PromptComposer";
import {
  defineDesignSystem,
  type IconButtonProps,
} from "@agent-native/toolkit/design-system";
import { ToolkitProvider } from "@agent-native/toolkit/provider";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AgentChat } from "./chat.js";
import {
  AgentKitChat,
  type AgentKitComposerProps,
  AgentMessagePartView,
  safeAgentHref,
  safeAgentImageSrc,
} from "./components.js";
import {
  AgentKitProvider,
  type AgentRunFailureRenderProps,
} from "./context.js";
import { AgentKitRoot } from "./root.js";

describe("AgentKitChat", () => {
  it("renders the complete reference surface from one managed component", () => {
    const transport: AgentTransport = {
      async startRun() {
        return { runId: "run-1" };
      },
      async *subscribeToRun() {},
      async cancelRun() {},
    };

    const html = renderToStaticMarkup(
      <AgentChat transport={transport} threadId="thread-1" load="manual" />,
    );

    expect(html).toContain("agentkit-chat");
    expect(html).toContain("agentkit-transcript");
    expect(html).toContain("agentkit-composer");
    expect(html).toContain('data-empty-composer-placement="center"');
  });

  it("keeps custom compositions on the same managed controller boundary", () => {
    const transport: AgentTransport = {
      async startRun() {
        return { runId: "run-1" };
      },
      async *subscribeToRun() {},
      async cancelRun() {},
    };

    const html = renderToStaticMarkup(
      <AgentKitRoot transport={transport} threadId="thread-1" load="manual">
        <div data-product-surface="true" />
      </AgentKitRoot>,
    );

    expect(html).toContain('data-product-surface="true"');
  });

  it("renders agent-authored suggestions only after the runtime publishes them", async () => {
    const transport: AgentTransport = {
      capabilities: { suggestions: true },
      async startRun() {
        return { runId: "run-suggestions" };
      },
      async *subscribeToRun() {
        const base = {
          threadId: "thread-1",
          runId: "run-suggestions",
          occurredAt: "2026-08-29T00:00:00.000Z",
        };
        yield {
          ...base,
          id: "event-1",
          sequence: 1,
          type: "run.started",
        } as const;
        yield {
          ...base,
          id: "event-2",
          sequence: 2,
          type: "suggestions.updated",
          suggestions: [
            {
              id: "review-release",
              label: "Review release summary",
              prompt: "Review the release summary in detail.",
            },
          ],
        } as const;
        yield {
          ...base,
          id: "event-3",
          sequence: 3,
          type: "run.completed",
        } as const;
      },
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });
    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Prepare the release",
    });
    await run.completed;

    const html = renderToStaticMarkup(
      <AgentKitProvider controller={client} threadId="thread-1">
        <AgentKitChat />
      </AgentKitProvider>,
    );

    expect(html).toContain('data-agent-suggestion-bar="true"');
    expect(html).toContain('aria-label="Suggested next actions"');
    expect(html).toContain("Review release summary");
  });

  it("ships standalone fallbacks for every internally rendered Toolkit surface", () => {
    const styles = readFileSync(
      new URL("./styles.css", import.meta.url),
      "utf8",
    );

    expect(styles).toContain('[data-agent-composer-slot="root"]');
    expect(styles).toContain('[data-agent-message-queue="true"]');
    expect(styles).toContain('[data-agent-native-composer-popover="true"]');
    expect(styles).toContain('[data-agent-suggestion-bar="true"]');
    expect(styles).not.toContain("@source");
    expect(styles).not.toContain('@import "@agent-native/toolkit/styles.css"');
    expect(styles).toMatch(
      /:where\(\.agentkit-chat\)[\s\S]*inline-size: 100%;[\s\S]*block-size: 100%;[\s\S]*min-inline-size: 0;[\s\S]*min-block-size: 0;/,
    );
    expect(styles).toMatch(
      /:where\(\.agentkit-chat\)[\s\S]*grid-template-columns: minmax\(0, 1fr\);/,
    );
    expect(styles).toContain(
      ".agentkit-chat-footer {\n  position: relative;\n  grid-column: 1;\n  grid-row: 3;",
    );
    expect(styles).toMatch(
      /\.agentkit-chat-footer \{[\s\S]*min-inline-size: 0;/,
    );
    expect(styles).toMatch(
      /\.agentkit-composer-stack \{[\s\S]*min-inline-size: 0;/,
    );
    expect(styles).toContain(
      ".agentkit-transcript {\n  grid-column: 1;\n  grid-row: 2;",
    );
    expect(styles).toMatch(
      /\.agentkit-transcript \{[\s\S]*inline-size: 100%;[\s\S]*overflow-y: auto;/,
    );
    expect(styles).not.toMatch(
      /\.agentkit-transcript \{[^}]*inline-size: min\(100%, 47rem\);/,
    );
    expect(styles).toMatch(
      /\.agentkit-transcript-content \{[\s\S]*inline-size: min\(100%, 47rem\);[\s\S]*margin-inline: auto;[\s\S]*padding: 1\.5rem 1rem;/,
    );
    expect(styles).toContain("overflow-anchor: none;");
    expect(styles).toMatch(
      /\.agentkit-agent \{[\s\S]*padding: 0\.125rem 0\.5rem;[\s\S]*border: 1px solid var\(--agentkit-border\);[\s\S]*border-radius: 999px;[\s\S]*background: var\(--agentkit-subtle\);/,
    );
    expect(styles).toContain("overscroll-behavior-block: contain;");
    expect(styles).toContain("scrollbar-color: transparent transparent;");
    expect(styles).toMatch(
      /\.agentkit-transcript\[data-scrollbar-visible="true"\][\s\S]*var\(--agentkit-text-muted\) 42%/,
    );
    expect(styles).toMatch(
      /\.agentkit-transcript\[data-scrollbar-visible="true"\]::\-webkit-scrollbar-thumb/,
    );
    expect(styles).toContain("grid-column: 1;");
    expect(styles).toContain(
      "grid-template-rows: minmax(0, 1fr) auto 1rem auto minmax(0, 1fr);",
    );

    const toolbarRule = styles.match(
      /\.agentkit-chat-toolbar :where\(button, \[role="button"\]\) \{([^}]*)\}/,
    )?.[1];
    expect(toolbarRule).toContain("min-inline-size: 1.75rem");
    expect(toolbarRule).toContain("padding-inline: 0.5rem");
    expect(toolbarRule).not.toMatch(/(?:^|\n)\s*inline-size:/);
    expect(styles).toMatch(
      /\.agentkit-chat-toolbar[\s\S]*:has\(> svg:only-child\)[\s\S]*inline-size: 1\.75rem/,
    );
    expect(styles).not.toContain("var(--shadow-color,");
    expect(styles).not.toContain("light-dark(");
    expect(styles).not.toContain("--agentkit-elevation-shadow-color");
    expect(styles).toContain("var(--agent-kit-composer-elevation, none)");
    expect(styles).toContain("--agent-kit-composer-border-color,");
    expect(styles).toContain("--agent-kit-composer-focus-border-color,");
    expect(styles).toContain(
      "border: 1px solid var(--agentkit-composer-border)",
    );
    expect(styles).toContain(
      "border-color: var(--agentkit-composer-focus-border)",
    );
    expect(styles).toContain("var(--agent-kit-overlay-elevation, none)");
    expect(styles).toContain("var(--agent-kit-control-elevation, none)");
    expect(styles).toContain("--agent-kit-composer-toolbar-control-font-size,");
    expect(styles).toContain(
      "--agent-kit-composer-toolbar-control-line-height,",
    );
    expect(styles).toContain(
      "--agent-kit-composer-toolbar-control-font-weight,",
    );
    const composerButtonRule = styles.match(
      /\.agentkit-composer button \{([^}]*)\}/,
    )?.[1];
    expect(composerButtonRule).toContain(
      "font-size: var(--agentkit-composer-toolbar-control-font-size)",
    );
    expect(composerButtonRule).toContain(
      "line-height: var(--agentkit-composer-toolbar-control-line-height)",
    );
    expect(composerButtonRule).toContain(
      "font-weight: var(--agentkit-composer-toolbar-control-font-weight)",
    );
    expect(composerButtonRule).not.toContain("font: inherit");
    expect(styles).toMatch(
      /@media \(max-width: 40rem\)[\s\S]*\[data-agent-composer-slot="area"\][\s\S]*padding-inline: 0;/,
    );
    expect(styles).toMatch(
      /\[data-agent-composer-slot="model-button"\] \{[\s\S]*max-inline-size: none;/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 40rem\)[\s\S]*\[data-agent-composer-slot="model-button"\][\s\S]*max-inline-size: 7\.5rem;/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 40rem\)[\s\S]*\.agent-composer-model-effort[\s\S]*display: none;/,
    );
    expect(styles).toContain("var(--agent-kit-recessed-surface, Canvas)");
    expect(styles).toContain("var(--agent-kit-raised-surface,");
    expect(styles).toContain("var(--agent-kit-text, CanvasText)");
    expect(styles).not.toMatch(
      /var\(--(?:background|foreground|card|popover|muted|border|primary|destructive|ring)(?:,|\))/,
    );
    const composerFocusRule = styles.match(
      /\.agentkit-composer\[data-agent-composer-slot="root"\]:focus-within \{([^}]*)\}/,
    )?.[1];
    expect(composerFocusRule).toContain(
      "border-color: var(--agentkit-composer-focus-border)",
    );
    expect(composerFocusRule).not.toContain("var(--agentkit-border)");
    expect(composerFocusRule).not.toContain("var(--agentkit-focus)");
  });

  it("keeps slash discovery typed and explicitly forwarded to PromptComposer", () => {
    const onSlashCommand: NonNullable<
      PromptComposerProps["onSlashCommand"]
    > = () => undefined;
    const props = {
      slashCommands: [
        { name: "review", description: "Review the current workspace" },
      ],
      slashSkills: [
        {
          name: "release-review",
          description: "Review a release",
          path: "/skills/release-review",
          source: "codebase" as const,
        },
      ],
      includeDefaultSlashCommands: false,
      includeDefaultSlashSkills: false,
      onSlashCommand,
    } satisfies AgentKitComposerProps;

    expect(props.onSlashCommand).toBe(onSlashCommand);

    const source = readFileSync(
      new URL("./components.tsx", import.meta.url),
      "utf8",
    );
    for (const prop of ["slashCommands", "slashSkills", "onSlashCommand"]) {
      expect(source).toContain(`${prop}={${prop}}`);
    }
    expect(source).toContain(
      "includeDefaultSlashCommands={includeDefaultSlashCommands ?? false}",
    );
    expect(source).toContain(
      "includeDefaultSlashSkills={includeDefaultSlashSkills ?? false}",
    );
    expect(source).toContain(
      'plusMenuMode ?? (capabilities.uploads ? "upload-only" : "hidden")',
    );
    expect(source).toContain("autoFocus={autoFocus}");
    expect(source).toContain("composerRef={composerRef}");
    expect(source).toContain(".finally(focusComposer)");
    expect(source).toContain(
      'execMode={executionMode === "plan" ? "plan" : "build"}',
    );
    expect(source).toContain("mode: executionMode");
    expect(source).toContain("control.steerQueued(item.id)");
    expect(source).toContain("control.removeQueued(item.id)");
    expect(source).toContain(
      "willQueue={active && queueWhileRunning && capabilities.messageQueue}",
    );
    expect(source).toContain(
      "showModelSelector && capabilities.modelSelection !== false",
    );
    expect(source).toContain("command.execute");
    expect(source.indexOf('className="agentkit-suggestions"')).toBeLessThan(
      source.indexOf("<PromptComposer"),
    );
  });

  it("allows navigable links and rejects executable URLs", () => {
    expect(safeAgentHref("https://example.com/source")).toBe(
      "https://example.com/source",
    );
    expect(safeAgentHref("/workspace/file.ts")).toBe("/workspace/file.ts");
    expect(safeAgentHref("javascript:alert(1)")).toBeUndefined();
    expect(safeAgentHref("data:text/html,unsafe")).toBeUndefined();
    expect(safeAgentImageSrc("https://example.com/agent.png")).toBe(
      "https://example.com/agent.png",
    );
    expect(safeAgentImageSrc("mailto:agent@example.com")).toBeUndefined();
  });

  it("renders multi-agent lifecycle and off-surface activity as one compact feed", async () => {
    const transport: AgentTransport = {
      capabilities: { multiAgentActivity: true },
      async startRun() {
        return { runId: "run-collaboration" };
      },
      async *subscribeToRun() {
        const base = {
          threadId: "thread-1",
          runId: "run-collaboration",
          occurredAt: "2026-08-29T00:00:00.000Z",
        };
        yield {
          ...base,
          id: "event-1",
          sequence: 1,
          type: "run.started",
        };
        yield {
          ...base,
          id: "event-2",
          sequence: 2,
          type: "agent.registered",
          agent: {
            id: "agent-planck",
            name: "Planck",
            kind: "subagent",
            status: "working",
            avatarUrl: "https://example.com/planck.png",
          },
        };
        yield {
          ...base,
          id: "event-3",
          sequence: 3,
          type: "agent.interaction",
          interaction: {
            id: "interaction-1",
            kind: "started",
            agentId: "agent-planck",
            targetAgentId: "agent-unregistered",
            scope: "workspace",
          },
        };
        yield {
          ...base,
          id: "event-4",
          sequence: 4,
          type: "activity.started",
          activity: {
            id: "activity-1",
            kind: "read",
            label: "Read framework contracts",
            status: "running",
            agentId: "agent-planck",
            scope: "external",
            source: {
              id: "app-agent-native",
              kind: "app",
              label: "Agent-Native",
              url: "/apps/agent-native",
            },
          },
        };
        yield {
          ...base,
          id: "event-5",
          sequence: 5,
          type: "message.created",
          message: {
            id: "assistant-1",
            role: "assistant",
            status: "complete",
            parts: [{ type: "text", text: "The release is ready." }],
          },
        };
        yield {
          ...base,
          id: "event-6",
          sequence: 6,
          type: "run.completed",
        };
      },
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });
    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Review the release",
    });
    await run.completed;

    const html = renderToStaticMarkup(
      <AgentKitProvider controller={client} threadId="thread-1">
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );

    expect(html).toContain('data-agent-collaboration-feed="true"');
    expect(html).toContain(
      'class="agentkit-agent" data-agent-id="agent-planck"',
    );
    expect(html).toContain('data-agent-id="agent-unregistered"');
    expect(html).not.toContain("agentkit-agent-avatar");
    expect(html).not.toContain("planck.png");
    expect(html).toContain("Planck");
    expect(html).toContain("started working");
    expect(html).toContain("Read framework contracts");
    expect(html).toContain("Agent-Native");
    expect(html.match(/Read framework contracts/g)).toHaveLength(1);
  });

  it("distinguishes run state, searches, and MCP tools in activity traces", async () => {
    const transport: AgentTransport = {
      async startRun() {
        return { runId: "run-semantic-activity" };
      },
      async *subscribeToRun() {
        const base = {
          threadId: "thread-1",
          runId: "run-semantic-activity",
          occurredAt: "2026-08-31T00:00:00.000Z",
        };
        yield {
          ...base,
          id: "event-1",
          sequence: 1,
          type: "run.started",
        } as const;
        yield {
          ...base,
          id: "event-2",
          sequence: 2,
          type: "tool.started",
          toolCall: {
            id: "tool-search",
            name: "docs-search",
            status: "running",
          },
        } as const;
        yield {
          ...base,
          id: "event-3",
          sequence: 3,
          type: "tool.updated",
          toolCall: {
            id: "tool-search",
            name: "docs-search",
            status: "completed",
          },
        } as const;
        yield {
          ...base,
          id: "event-4",
          sequence: 4,
          type: "tool.started",
          toolCall: {
            id: "tool-mcp",
            name: "mcp__slack__search_messages",
            status: "running",
          },
        } as const;
        yield {
          ...base,
          id: "event-5",
          sequence: 5,
          type: "tool.updated",
          toolCall: {
            id: "tool-mcp",
            name: "mcp__slack__search_messages",
            status: "completed",
          },
        } as const;
        yield {
          ...base,
          id: "event-6",
          sequence: 6,
          type: "run.completed",
        } as const;
      },
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });
    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Search the docs and Slack",
    });
    await run.completed;

    const html = renderToStaticMarkup(
      <AgentKitProvider controller={client} threadId="thread-1">
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );

    expect(html).toContain('data-activity-kind="search"');
    expect(html).toContain('data-activity-kind="mcp"');
    expect(html).toContain("tabler-icon-search");
    expect(html).toContain("tabler-icon-plug-connected");
    expect(html).toContain("tabler-icon-activity");
  });

  it("keeps chat chrome conversation-aware and slots replaceable", async () => {
    const transport: AgentTransport = {
      async startRun() {
        return { runId: "run-1" };
      },
      async *subscribeToRun() {},
      async cancelRun() {},
      async getThreadSnapshot() {
        return {
          id: "thread-1",
          title: "Workspace review",
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:00.000Z",
          messages: [
            {
              id: "message-1",
              role: "assistant",
              parts: [{ type: "text", text: "The workspace is healthy." }],
            },
          ],
        };
      },
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-1");

    const html = renderToStaticMarkup(
      <AgentKitProvider controller={client} threadId="thread-1">
        <AgentKitChat
          title="Workspace review"
          toolbar={<button type="button">Share</button>}
          composer={false}
        />
      </AgentKitProvider>,
    );

    expect(html).toContain("Workspace review");
    expect(html).toContain("The workspace is healthy.");
    expect(html).toContain("agentkit-chat-toolbar");
  });

  it("server-renders approvals, widgets, and queued messages", async () => {
    const transport: AgentTransport = {
      capabilities: { messageQueue: true, widgets: true, approvals: true },
      async startRun() {
        return { runId: "run-1" };
      },
      async *subscribeToRun() {
        const base = {
          threadId: "thread-1",
          runId: "run-1",
          occurredAt: "2026-08-29T00:00:00.000Z",
        };
        yield {
          ...base,
          id: "event-1",
          sequence: 1,
          type: "run.started",
        };
        yield {
          ...base,
          id: "event-2",
          sequence: 2,
          type: "approval.requested",
          request: {
            id: "approval-1",
            title: "Publish the dashboard?",
            description: "Review the workspace changes before continuing.",
          },
        };
        yield {
          ...base,
          id: "event-3",
          sequence: 3,
          type: "run.completed",
        };
      },
      async cancelRun() {},
      async removeQueuedMessage() {},
      async getThreadSnapshot() {
        return {
          id: "thread-1",
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:00.000Z",
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              parts: [
                {
                  type: "widget",
                  widget: {
                    id: "widget-1",
                    kind: "workspace-health",
                    title: "Workspace health",
                    data: "12 checks passed",
                    actions: [
                      {
                        id: "open-report",
                        label: "Open report",
                        action: "dashboard.open",
                      },
                    ],
                  },
                },
              ],
            },
          ],
          queuedMessages: [
            {
              id: "queued-1",
              threadId: "thread-1",
              text: "Explain the remaining failures",
              createdAt: "2026-08-29T00:00:00.000Z",
            },
          ],
        };
      },
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-1");
    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Publish when ready",
    });
    await run.completed;

    const html = renderToStaticMarkup(
      <AgentKitProvider controller={client} threadId="thread-1">
        <AgentKitChat />
      </AgentKitProvider>,
    );

    expect(html).toContain('aria-labelledby="approval-1-title"');
    expect(html).toContain("Publish the dashboard?");
    expect(html).toContain("Review the workspace changes before continuing.");
    expect(html).toContain('data-widget-kind="workspace-health"');
    expect(html).toContain("Workspace health");
    expect(html).toContain("12 checks passed");
    expect(html).toContain("Open report");
    expect(html).toContain("Explain the remaining failures");
    expect(html).toContain('aria-label="Queued messages"');
  });

  it("renders message mutations only when the transport advertises them", async () => {
    const transport: AgentTransport = {
      capabilities: { feedback: true, threadForking: true },
      async startRun() {
        return { runId: "run-1" };
      },
      async *subscribeToRun() {},
      async cancelRun() {},
      async submitFeedback() {},
      async forkThread(input) {
        return {
          id: `${input.threadId}-fork`,
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:00.000Z",
        };
      },
      async getThreadSnapshot() {
        return {
          id: "thread-1",
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:00.000Z",
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              parts: [{ type: "text", text: "Ready." }],
            },
          ],
        };
      },
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-1");

    const htmlWithoutNavigation = renderToStaticMarkup(
      <AgentKitProvider controller={client} threadId="thread-1">
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );

    expect(htmlWithoutNavigation).toContain('aria-label="Helpful"');
    expect(htmlWithoutNavigation).toContain('aria-label="Not helpful"');
    expect(htmlWithoutNavigation).toContain('aria-label="Copy message"');
    expect(htmlWithoutNavigation).not.toContain(
      'aria-label="Fork conversation"',
    );

    const htmlWithNavigation = renderToStaticMarkup(
      <AgentKitProvider
        controller={client}
        threadId="thread-1"
        onThreadForked={() => undefined}
      >
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );

    expect(htmlWithNavigation).toContain('aria-label="Fork conversation"');
  });

  it("passes product slots, labels, and registries through the AgentChat facade", async () => {
    const transport: AgentTransport = {
      capabilities: {
        messageQueue: true,
        suggestions: true,
        widgets: true,
      },
      async startRun() {
        return { runId: "run-1" };
      },
      async *subscribeToRun() {},
      async cancelRun() {},
      async getThreadSnapshot() {
        return {
          id: "thread-slots",
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:00.000Z",
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              parts: [
                {
                  type: "widget",
                  widget: {
                    id: "widget-1",
                    kind: "workspace-health",
                    title: "Workspace health",
                  },
                },
              ],
            },
          ],
          queuedMessages: [
            {
              id: "queued-1",
              threadId: "thread-slots",
              text: "Check the deployment",
              createdAt: "2026-08-29T00:00:00.000Z",
            },
          ],
          events: [
            {
              id: "event-suggestions",
              threadId: "thread-slots",
              runId: "run-1",
              sequence: 1,
              occurredAt: "2026-08-29T00:00:00.000Z",
              type: "suggestions.updated",
              suggestions: [
                {
                  id: "suggestion-1",
                  label: "Review the release",
                  prompt: "Review the release",
                },
              ],
            },
          ],
        };
      },
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-slots");

    const html = renderToStaticMarkup(
      <AgentChat
        client={client}
        threadId="thread-slots"
        load="manual"
        title="Release room"
        toolbar={<button type="button">Share</button>}
        labels={{ conversation: "Release conversation" }}
        slots={{
          header: ({ children, threadId }) => (
            <div data-slot="header" data-thread-id={threadId}>
              {children}
            </div>
          ),
          toolbar: ({ children }) => <div data-slot="toolbar">{children}</div>,
          transcript: ({ children }) => (
            <div data-slot="transcript">{children}</div>
          ),
          footer: ({ children }) => <div data-slot="footer">{children}</div>,
          queue: ({ items }) => <div data-slot="queue">{items[0]?.text}</div>,
          suggestions: ({ suggestions }) => (
            <div data-slot="suggestions">{suggestions[0]?.label}</div>
          ),
          messageSupplement: ({ value }) => (
            <div data-slot="message-supplement">{value.role}</div>
          ),
          messageActions: ({ threadId }) => (
            <div data-slot="message-actions">{threadId}</div>
          ),
        }}
        registry={{
          widgets: {
            "workspace-health": ({ value }) => (
              <div data-registry="widget">{value.title}</div>
            ),
          },
        }}
      />,
    );

    for (const slot of [
      "header",
      "toolbar",
      "transcript",
      "footer",
      "queue",
      "suggestions",
      "message-supplement",
      "message-actions",
    ]) {
      expect(html).toContain(`data-slot="${slot}"`);
    }
    expect(html).toContain('aria-label="Release room"');
    expect(html).toContain("Check the deployment");
    expect(html).toContain("Review the release");
    expect(html).toContain('data-registry="widget"');
    expect(html).toContain("Workspace health");
  });

  it("renders standard controls through the registered design-system seam", async () => {
    const transport: AgentTransport = {
      async startRun() {
        return { runId: "run-1" };
      },
      async *subscribeToRun() {},
      async cancelRun() {},
      async getThreadSnapshot() {
        return {
          id: "thread-design-system",
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:00.000Z",
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              parts: [{ type: "text", text: "Ready." }],
            },
          ],
        };
      },
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-design-system");
    const CustomIconButton = vi.fn(({ label, icon }: IconButtonProps) => (
      <button type="button" aria-label={label} data-design-system="icon">
        {icon}
      </button>
    ));

    const html = renderToStaticMarkup(
      <ToolkitProvider
        designSystem={defineDesignSystem({
          name: "Test adapter",
          components: { IconButton: CustomIconButton },
        })}
      >
        <AgentKitProvider controller={client} threadId="thread-design-system">
          <AgentKitChat composer={false} />
        </AgentKitProvider>
      </ToolkitProvider>,
    );

    expect(CustomIconButton).toHaveBeenCalled();
    expect(html).toContain('data-design-system="icon"');
    expect(html).toContain('aria-label="Copy message"');
  });

  it("renders localized progressive reasoning and preserves hidden and slotted behavior", async () => {
    const transport: AgentTransport = {
      async startRun() {
        return { runId: "run-1" };
      },
      async *subscribeToRun() {},
      async cancelRun() {},
      async getThreadSnapshot() {
        return {
          id: "thread-1",
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:00.000Z",
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              status: "complete",
              parts: [
                {
                  type: "reasoning",
                  label: "Reviewed release boundaries",
                  text: "Checking release boundaries.",
                },
                {
                  type: "reasoning",
                  text: "Private chain of thought.",
                  visibility: "hidden",
                },
              ],
            },
          ],
        };
      },
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-1");

    const html = renderToStaticMarkup(
      <AgentKitProvider
        controller={client}
        threadId="thread-1"
        labels={{ reasoning: "Reviewing release" }}
      >
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );

    expect(html).toContain("Reviewed release boundaries");
    expect(html).toContain("Checking release boundaries.");
    expect(html).not.toContain("Private chain of thought.");

    const activeHtml = renderToStaticMarkup(
      <AgentKitProvider
        controller={client}
        threadId="thread-1"
        labels={{ reasoning: "Reviewing release" }}
      >
        <AgentMessagePartView
          active
          resetKey="active-reasoning"
          threadId="thread-1"
          value={{ type: "reasoning", text: "Checking release boundaries." }}
        />
      </AgentKitProvider>,
    );

    expect(activeHtml).toContain(
      'class="agentkit-reasoning" data-active="true"',
    );
    expect(activeHtml).toContain("Reviewing release");

    const slotted = renderToStaticMarkup(
      <AgentKitProvider
        controller={client}
        threadId="thread-1"
        slots={{
          reasoning: ({ value }) => (
            <span data-custom-reasoning="true">{value.text}</span>
          ),
        }}
      >
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );

    expect(slotted).toContain('data-custom-reasoning="true"');
    expect(slotted).not.toContain("agentkit-reasoning-summary");
  });

  it("renders one run failure and passes its exact contract to a custom slot", async () => {
    const failure = {
      code: "tool_timeout",
      message: "The dashboard check timed out.",
      retryable: true,
      details: { tool: "dashboard.check" },
    };
    const transport: AgentTransport = {
      async startRun() {
        return { runId: "run-failure" };
      },
      async *subscribeToRun() {
        const base = {
          threadId: "thread-1",
          runId: "run-failure",
          occurredAt: "2026-08-29T00:00:00.000Z",
        };
        yield {
          ...base,
          id: "event-1",
          sequence: 1,
          type: "run.started",
        };
        yield {
          ...base,
          id: "event-2",
          sequence: 2,
          type: "message.created",
          message: {
            id: "assistant-1",
            role: "assistant",
            parts: [{ type: "text", text: "Starting the checks." }],
          },
        };
        yield {
          ...base,
          id: "event-3",
          sequence: 3,
          type: "message.created",
          message: {
            id: "assistant-2",
            role: "assistant",
            parts: [{ type: "text", text: "The final check did not finish." }],
          },
        };
        yield {
          ...base,
          id: "event-4",
          sequence: 4,
          type: "run.failed",
          error: failure,
        };
      },
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });
    const run = await client.sendMessage({
      threadId: "thread-1",
      text: "Run the dashboard checks",
    });
    await run.completed;

    const defaultHtml = renderToStaticMarkup(
      <AgentKitProvider controller={client} threadId="thread-1">
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );

    expect(defaultHtml.match(/class="agentkit-run-failure"/g)).toHaveLength(1);
    expect(defaultHtml).toContain('data-run-id="run-failure"');
    expect(defaultHtml).toContain('data-error-code="tool_timeout"');
    expect(defaultHtml).toContain("The dashboard check timed out.");

    const slotCalls: AgentRunFailureRenderProps[] = [];
    const RunFailure = (props: AgentRunFailureRenderProps) => {
      slotCalls.push(props);
      return (
        <div data-custom-run-failure={props.runId}>{props.error.message}</div>
      );
    };
    const customHtml = renderToStaticMarkup(
      <AgentKitProvider
        controller={client}
        threadId="thread-1"
        slots={{ runFailure: RunFailure }}
      >
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );

    expect(customHtml.match(/data-custom-run-failure=/g)).toHaveLength(1);
    expect(slotCalls).toEqual([
      { error: failure, runId: "run-failure", threadId: "thread-1" },
    ]);
  });
});
