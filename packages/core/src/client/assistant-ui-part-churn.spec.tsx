// @vitest-environment happy-dom


import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useAssistantRuntime,
  useLocalRuntime,
  useMessagePartText,
  type AssistantRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assistantUiRecoverableRenderErrorKind } from "./assistant-ui-recovery.js";

let streamFrames: Part[][] = [];

const scriptedAdapter: ChatModelAdapter = {
  async *run() {
    for (const content of streamFrames) {
      yield { content: content as never };
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  },
};

type Part = Record<string, unknown>;

function repoWith(parts: Part[]) {
  return {
    messages: [
      {
        parentId: null,
        message: {
          id: "u1",
          role: "user" as const,
          createdAt: new Date(0),
          content: [{ type: "text", text: "hi" }],
          status: { type: "complete", reason: "stop" },
          metadata: { custom: {} },
        },
      },
      {
        parentId: "u1",
        message: {
          id: "a1",
          role: "assistant" as const,
          createdAt: new Date(0),
          content: parts,
          status: { type: "complete", reason: "stop" },
          metadata: { custom: {} },
        },
      },
    ],
    headId: "a1",
  };
}

const TEXT: Part = { type: "text", text: "Working on it." };
const PENDING_TOOL: Part = {
  type: "tool-call",
  toolCallId: "tc_1",
  toolName: "query",
  argsText: "{}",
  args: {},
};
const DONE_TOOL: Part = { ...PENDING_TOOL, result: "ok" };
const RENAMED_TOOL: Part = { ...DONE_TOOL, toolCallId: "run1:tc_1" };
const MORE_TEXT: Part = { type: "text", text: "Here is the answer." };

function ProbeText() {
  const part = useMessagePartText();
  return <span data-part="text">{part.text}</span>;
}

function ProbeTool() {
  return <span data-part="tool" />;
}

function ProbeMessage({ role }: { role: string }) {
  return (
    <MessagePrimitive.Root>
      <div data-role={role}>
        <MessagePrimitive.Parts
          components={{ Text: ProbeText, tools: { Fallback: ProbeTool } }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}

function Probe({
  runtimeRef,
}: {
  runtimeRef: { current: AssistantRuntime | null };
}) {
  runtimeRef.current = useAssistantRuntime();
  return (
    <ThreadPrimitive.Root>
      {/* Deliberately unkeyed — this is the thing under test. */}
      <ThreadPrimitive.Messages
        components={{
          UserMessage: () => <ProbeMessage role="user" />,
          AssistantMessage: () => <ProbeMessage role="assistant" />,
        }}
      />
    </ThreadPrimitive.Root>
  );
}

describe("assistant-ui part churn without a structural remount key", () => {
  let container: HTMLDivElement;
  let root: Root;
  let errors: unknown[];
  let restoreConsole: (() => void) | null = null;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container, {
      onUncaughtError: (error: unknown) => errors.push(error),
      onCaughtError: (error: unknown) => errors.push(error),
    } as Parameters<typeof createRoot>[1]);
    errors = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args[0]);
    };
    restoreConsole = () => {
      console.error = originalError;
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    restoreConsole?.();
    vi.unstubAllGlobals();
  });

  it("survives the part transitions of a streamed turn", async () => {
    const runtimeRef: { current: AssistantRuntime | null } = { current: null };

    await act(async () => {
      root.render(
        <Wrapper runtimeRef={runtimeRef}>
          <Probe runtimeRef={runtimeRef} />
        </Wrapper>,
      );
    });

    const importRepo = async (parts: Part[]) => {
      await act(async () => {
        (
          runtimeRef.current as unknown as {
            thread: { import: (data: unknown) => void };
          }
        ).thread.import(repoWith(parts));
      });
    };

    await importRepo([TEXT]);
    await importRepo([TEXT, PENDING_TOOL]);
    await importRepo([TEXT, DONE_TOOL]);
    await importRepo([TEXT, RENAMED_TOOL]);
    await importRepo([TEXT, RENAMED_TOOL, MORE_TEXT]);
    await importRepo([TEXT, MORE_TEXT]);

    const recoverable = errors
      .map((error) => assistantUiRecoverableRenderErrorKind(error))
      .filter(Boolean);

    expect({ recoverable, total: errors.length }).toEqual({
      recoverable: [],
      total: 0,
    });
    expect(container.querySelectorAll('[data-role="assistant"]').length).toBe(
      1,
    );
    expect(
      container.querySelectorAll('[data-part="text"]').length,
    ).toBeGreaterThan(1);
  });

  it("survives the same part churn arriving through the streaming adapter", async () => {
    streamFrames = [
      [TEXT],
      [TEXT, PENDING_TOOL],
      [TEXT, DONE_TOOL],
      [TEXT, RENAMED_TOOL],
      [TEXT, RENAMED_TOOL, MORE_TEXT],
      [TEXT, MORE_TEXT],
    ];
    const runtimeRef: { current: AssistantRuntime | null } = { current: null };

    await act(async () => {
      root.render(
        <Wrapper runtimeRef={runtimeRef}>
          <Probe runtimeRef={runtimeRef} />
        </Wrapper>,
      );
    });

    await act(async () => {
      await (
        runtimeRef.current as unknown as {
          thread: { append: (msg: unknown) => Promise<void> | void };
        }
      ).thread.append({
        role: "user",
        content: [{ type: "text", text: "go" }],
      });
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const recoverable = errors
      .map((error) => assistantUiRecoverableRenderErrorKind(error))
      .filter(Boolean);

    expect({ recoverable, total: errors.length }).toEqual({
      recoverable: [],
      total: 0,
    });
    expect(
      container.querySelectorAll('[data-part="text"]').length,
    ).toBeGreaterThan(1);
  });
});

function Wrapper({
  children,
}: {
  runtimeRef: { current: AssistantRuntime | null };
  children: React.ReactNode;
}) {
  const runtime = useLocalRuntime(scriptedAdapter);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
