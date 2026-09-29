// @vitest-environment happy-dom

import type {
  PromptComposerProps,
  TiptapComposerHandle,
} from "../../../agentkit.js";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentKitClient } from "@agent-native/agentkit/client";
import type { AgentSuggestion, AgentTransport } from "@agent-native/agentkit/protocol";
import { AgentKitComposer } from "./components.js";
import { AgentKitProvider } from "./context.js";

const draft = vi.hoisted(() => ({
  files: [] as File[],
  references: [] as Parameters<PromptComposerProps["onSubmit"]>[2],
  text: "Keep the current draft",
}));
vi.mock("../../../agentkit.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../agentkit.js")>();
  const React = await import("react");
  return {
    ...actual,
    PromptComposer: (props: PromptComposerProps) => {
      React.useLayoutEffect(() => {
        const handle = {
          focus: vi.fn(),
          submitWithText: async (text: string) => {
            if (props.disabled || props.submitting) return;
            if (props.onBeforeSubmit && !(await props.onBeforeSubmit())) return;
            await props.onSubmit(text, draft.files, draft.references, {
              intent: "immediate",
              contextItems: props.contextItems,
            });
            draft.files = [];
            draft.text = "";
          },
        } as unknown as TiptapComposerHandle;
        const ref = props.composerRef;
        if (ref && typeof ref !== "function") ref.current = handle;
        return () => {
          if (ref && typeof ref !== "function" && ref.current === handle)
            ref.current = null;
        };
      });
      return null;
    },
  };
});

const at = "2026-09-28T00:00:00.000Z";
const suggestion: AgentSuggestion = {
  id: "next",
  runId: "completed-run",
  label: "Refine layout",
  prompt: "Refine the selected design using our agreed layout and spacing.",
  metadata: { context: "Keep the selected design's typography." },
};
let client: AgentKitClient;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  draft.files = [
    new File(["reference"], "reference.png", { type: "image/png" }),
  ];
  draft.references = [{ type: "file", path: "/reference.md" }];
  draft.text = "Keep the current draft";
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.dispose();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup() {
  const runtime = {
    capabilities: { suggestions: true, uploads: true },
    async getThreadSnapshot(id: string) {
      return {
        id,
        createdAt: at,
        updatedAt: at,
        messages: [
          {
            id: "user",
            role: "user" as const,
            parts: [{ type: "text" as const, text: "Create a design" }],
          },
          {
            id: "assistant",
            role: "assistant" as const,
            parts: [{ type: "text" as const, text: "Created." }],
          },
        ],
        runs: [
          {
            id: "completed-run",
            threadId: id,
            status: "completed" as const,
            lastSequence: 3,
            startedAt: at,
            completedAt: at,
          },
        ],
        suggestions: [suggestion],
      };
    },
    startRun: vi
      .fn<AgentTransport["startRun"]>()
      .mockResolvedValue({ runId: "next-run" }),
    async *subscribeToRun() {},
    async cancelRun() {},
  } satisfies AgentTransport;
  client = new AgentKitClient({ transport: runtime });
  await client.loadThread("thread-1");
  const upload = vi.spyOn(client, "uploadFiles").mockResolvedValue([
    {
      type: "file",
      name: "reference.png",
      mediaType: "image/png",
      url: "https://example.test/reference.png",
    },
  ]);
  return { runtime, upload };
}

describe("standalone follow-up submission", () => {
  it.each([false, true])(
    "sends the full suggestion through the normal composer with displayed context (custom slot: %s)",
    async (custom) => {
      const { runtime, upload } = await setup();
      const beforeSend = vi.fn();
      const preflight = vi.fn(async () => true);
      await act(async () =>
        root.render(
          <AgentKitProvider
            controller={client}
            threadId="thread-1"
            slots={
              custom
                ? {
                    suggestions: ({ suggestions, onSelect }) => (
                      <button onClick={() => onSelect?.(suggestions[0]!)}>
                        Custom next
                      </button>
                    ),
                  }
                : undefined
            }
          >
            <AgentKitComposer
              autoFocus={false}
              onBeforeSubmit={preflight}
              beforeSend={beforeSend}
              contextItems={[
                {
                  key: "figma",
                  title: "Figma",
                  context: "Authorized Figma context",
                },
              ]}
            />
          </AgentKitProvider>,
        ),
      );
      const button = [...container.querySelectorAll("button")].find(
        (item) =>
          item.textContent === (custom ? "Custom next" : suggestion.label),
      );
      expect(button).toBeDefined();
      await act(async () => button!.click());
      expect(preflight).toHaveBeenCalledOnce();
      expect(upload).toHaveBeenCalledOnce();
      expect(beforeSend).toHaveBeenCalledOnce();
      expect(runtime.startRun).toHaveBeenCalledOnce();
      const request = runtime.startRun.mock.calls[0]![0];
      expect(request.threadId).toBe("thread-1");
      expect(request.messages.at(-1)?.parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "text",
            text: expect.stringContaining(suggestion.prompt),
          }),
          expect.objectContaining({ type: "file", name: "reference.png" }),
        ]),
      );
      expect(request.messages.at(-1)?.parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            text: expect.stringContaining("Authorized Figma context"),
          }),
        ]),
      );
      expect(request.messages.at(-1)?.metadata).toMatchObject({
        suggestion,
        references: [{ type: "file", path: "/reference.md" }],
      });
      expect(draft.files).toEqual([]);
    },
  );

  it.each(["thread", "disabled", "permission"])(
    "retains draft files and context when %s changes during pre-send",
    async (change) => {
      const { runtime } = await setup();
      const pending = Promise.withResolvers<void>();
      const beforeSend = vi.fn(() => pending.promise);
      const contextItems = [
        {
          key: "figma",
          title: "Figma",
          context: "Selected provider reference",
        },
      ];
      const files = draft.files;
      const render = (threadId = "thread-1", disabled = false) =>
        root.render(
          <AgentKitProvider controller={client} threadId={threadId}>
            <AgentKitComposer
              autoFocus={false}
              beforeSend={beforeSend}
              disabled={disabled}
              contextItems={contextItems}
            />
          </AgentKitProvider>,
        );
      await act(async () => render());
      const button = [...container.querySelectorAll("button")].find(
        (item) => item.textContent === suggestion.label,
      )!;
      await act(async () => button.click());
      expect(beforeSend).toHaveBeenCalledOnce();
      await act(async () => {
        if (change === "thread") render("thread-2");
        if (change === "disabled") render("thread-1", true);
      });
      await act(async () => {
        if (change === "permission")
          pending.reject(new Error("Permission revoked"));
        else pending.resolve();
      });
      expect(runtime.startRun).not.toHaveBeenCalled();
      expect(draft.files).toEqual(files);
      expect(draft.text).toBe("Keep the current draft");
      expect(contextItems).toEqual([
        {
          key: "figma",
          title: "Figma",
          context: "Selected provider reference",
        },
      ]);
    },
  );
});
