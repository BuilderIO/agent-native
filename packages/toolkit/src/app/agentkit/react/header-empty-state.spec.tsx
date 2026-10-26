// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AgentKitClient } from "@agent-native/agentkit/client";
import type {
  AgentSuggestion,
  AgentThreadSnapshot,
  AgentTransport,
} from "@agent-native/agentkit/protocol";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentKitChat, AgentKitComposer } from "./components.js";
import { AgentKitProvider } from "./context.js";

const at = "2026-10-23T00:00:00.000Z";
const suggestion: AgentSuggestion = {
  id: "next",
  runId: "run-1",
  label: "Summarize my inbox",
  prompt: "Summarize my inbox",
};

let client: AgentKitClient | undefined;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  client?.dispose();
  client = undefined;
  container.remove();
  vi.unstubAllGlobals();
});

function snapshot(
  id: string,
  options: { conversation?: boolean; running?: boolean; suggestions?: boolean },
): AgentThreadSnapshot {
  if (!options.conversation) {
    return { id, createdAt: at, updatedAt: at, messages: [] };
  }
  return {
    id,
    createdAt: at,
    updatedAt: at,
    messages: [
      { id: "user", role: "user", parts: [{ type: "text", text: "Hi" }] },
      {
        id: "assistant",
        role: "assistant",
        parts: [{ type: "text", text: "Hello." }],
      },
    ],
    runs: [
      {
        id: "run-1",
        threadId: id,
        status: options.running ? "running" : "completed",
        lastSequence: 3,
        startedAt: at,
        ...(options.running ? {} : { completedAt: at }),
      },
    ],
    activeRunIds: options.running ? ["run-1"] : [],
    suggestions: options.suggestions ? [suggestion] : [],
  };
}

async function loadClient(
  options: Parameters<typeof snapshot>[1] = {},
): Promise<AgentKitClient> {
  const transport = {
    capabilities: { suggestions: true },
    assertAiSetupReady: vi.fn(async () => {}),
    async getThreadSnapshot(id: string) {
      return snapshot(id, options);
    },
    async startRun() {
      return { runId: "run-2" };
    },
    async *subscribeToRun() {},
    async cancelRun() {},
  } satisfies AgentTransport;
  client = new AgentKitClient({ transport });
  await client.loadThread("thread-1");
  return client;
}

const header = () =>
  container.querySelector<HTMLElement>("[data-agentkit-chat-header]");

describe("AgentKitChat header", () => {
  it("reserves the header from the empty state and keeps the same row on first send", async () => {
    const controller = await loadClient();
    const render = (hasRenderedMessages: boolean) =>
      root.render(
        <AgentKitProvider controller={controller} threadId="thread-1">
          <AgentKitChat
            title="Release room"
            toolbar={<button type="button">Fork</button>}
            composer={false}
            hasRenderedMessages={hasRenderedMessages}
          />
        </AgentKitProvider>,
      );
    await act(async () => render(false));

    const emptyHeader = header();
    expect(emptyHeader?.className).toContain("agentkit-chat-header");
    expect(container.querySelector('[data-agentkit-region="header"]')).toBe(
      emptyHeader,
    );
    expect(emptyHeader?.dataset.hasTitle).toBe("false");
    expect(container.querySelector(".agentkit-chat-title")).toBeNull();
    expect(emptyHeader?.querySelector(".agentkit-chat-toolbar")).not.toBeNull();
    const chat = container.querySelector<HTMLElement>(".agentkit-chat");
    expect(chat?.dataset.empty).toBe("true");
    expect(chat?.dataset.hasHeader).toBe("true");

    await act(async () => render(true));

    expect(header()).toBe(emptyHeader);
    expect(header()?.dataset.hasTitle).toBe("true");
    expect(container.querySelector(".agentkit-chat-title")?.textContent).toBe(
      "Release room",
    );
  });

  it("floats a toolbar with no title and renders no header without either", async () => {
    const controller = await loadClient({ conversation: true });
    await act(async () =>
      root.render(
        <AgentKitProvider controller={controller} threadId="thread-1">
          <AgentKitChat
            toolbar={<button type="button">Fork</button>}
            composer={false}
          />
        </AgentKitProvider>,
      ),
    );
    expect(header()?.dataset.hasTitle).toBe("false");
    expect(container.querySelector(".agentkit-chat-title")).toBeNull();

    await act(async () =>
      root.render(
        <AgentKitProvider controller={controller} threadId="thread-1">
          <AgentKitChat composer={false} />
        </AgentKitProvider>,
      ),
    );
    expect(header()).toBeNull();
    expect(
      container.querySelector<HTMLElement>(".agentkit-chat")?.dataset.hasHeader,
    ).toBe("false");
  });

  it("drops the divider and keeps the header in the first grid row", () => {
    const styles = readFileSync(join(__dirname, "styles.css"), "utf8");
    const rule = styles.match(/\n {2}\.agentkit-chat-header \{([^}]*)\}/)?.[1];
    expect(rule).toBeDefined();
    expect(rule).not.toContain("border-block-end");
    expect(rule).toContain("grid-row: 1;");
    expect(rule).toContain("block-size: var(--agentkit-chat-header-height);");
  });
});

describe("AgentKitChat empty state", () => {
  it("shows the localized greeting as visible text with no icon", async () => {
    const controller = await loadClient();
    await act(async () =>
      root.render(
        <AgentKitProvider
          controller={controller}
          threadId="thread-1"
          labels={{ emptyStateText: "Wie kann ich helfen?" }}
        >
          <AgentKitChat composer={false} />
        </AgentKitProvider>,
      ),
    );
    const greeting = container.querySelector(".agentkit-empty-state-greeting");
    expect(greeting?.textContent).toBe("Wie kann ich helfen?");
    expect(greeting?.closest(".sr-only, .agentkit-visually-hidden")).toBeNull();
    expect(
      container.querySelector("[data-agentkit-empty-state] svg"),
    ).toBeNull();
  });

  it("lets a host empty-state slot replace the greeting", async () => {
    const controller = await loadClient();
    await act(async () =>
      root.render(
        <AgentKitProvider
          controller={controller}
          threadId="thread-1"
          slots={{ emptyState: () => <h1>Start here</h1> }}
        >
          <AgentKitChat composer={false} />
        </AgentKitProvider>,
      ),
    );
    expect(container.querySelector("[data-agentkit-empty-state]")).toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe("Start here");
  });
});

describe("built-in follow-up row", () => {
  it("mounts one single-line row only while the idle thread has follow-ups", async () => {
    const idle = await loadClient({ conversation: true, suggestions: true });
    await act(async () =>
      root.render(
        <AgentKitProvider controller={idle} threadId="thread-1">
          <AgentKitComposer autoFocus={false} />
        </AgentKitProvider>,
      ),
    );
    const rows = container.querySelectorAll("[data-agentkit-suggestions-row]");
    expect(rows).toHaveLength(1);
    expect(
      rows[0]?.querySelector('[data-agent-suggestion-track="true"]')?.className,
    ).toContain("flex-nowrap");
    expect(rows[0]?.textContent).toContain(suggestion.label);

    await act(async () => root.unmount());
    idle.dispose();
    root = createRoot(container);
    const none = await loadClient({ conversation: true });
    await act(async () =>
      root.render(
        <AgentKitProvider controller={none} threadId="thread-1">
          <AgentKitComposer autoFocus={false} />
        </AgentKitProvider>,
      ),
    );
    expect(
      container.querySelector("[data-agentkit-suggestions-row]"),
    ).toBeNull();
  });

  it("fades chips in and skips the fade under reduced motion", () => {
    const styles = readFileSync(join(__dirname, "styles.css"), "utf8");
    expect(styles).toMatch(
      /\.agentkit-suggestions-row \{[^}]*min-block-size: 2\.5rem;/,
    );
    // Transcript text fades out above the footer instead of being cut by an
    // opaque row.
    expect(styles).not.toMatch(/\.agentkit-suggestions-row \{[^}]*background:/);
    expect(styles).toMatch(
      /\.agentkit-chat-footer::before \{[^}]*linear-gradient\(to bottom, transparent, var\(--agentkit-canvas\)\)/,
    );
    expect(styles).toMatch(
      /\.agentkit-suggestions-row > \.agentkit-suggestions,[^{]*\{\s*animation: agentkit-suggestions-in/,
    );
    const reduced = styles.slice(
      styles.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reduced).toMatch(
      /\.agentkit-suggestions-row > \.agentkit-suggestions,[^{]*\{\s*animation: none;/,
    );
  });
});
