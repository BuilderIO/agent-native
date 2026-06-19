import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import {
  createCodeAgentRunRecord,
  codeAgentRunTranscriptPath,
  getCodeAgentRunRecord,
  listCodeAgentTranscriptEvents,
  queueCodeAgentFollowUp,
  updateCodeAgentRunRecord,
} from "./code-agent-runs.js";
import {
  buildCodeAgentSystemPrompt,
  buildRepoInstructionsBlock,
  buildStructuredMessagesFromEvents,
  classifyCodeAgentCommandPermission,
  codeAgentSystemPrompt,
  executeCodeAgentRun,
  executePendingCodeAgentApproval,
} from "./code-agent-executor.js";
import type { CodeAgentTranscriptEvent } from "./code-agent-runs.js";
import type { EngineContentPart } from "../agent/engine/types.js";
import type { AgentEngine } from "../agent/engine/types.js";

const tmpRoots: string[] = [];
const providerEnvKeys = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "COHERE_API_KEY",
  "BUILDER_PRIVATE_KEY",
] as const;
const originalProviderEnv = new Map(
  providerEnvKeys.map((key) => [key, process.env[key]]),
);
const originalPath = process.env.PATH;

afterEach(() => {
  delete process.env.AGENT_NATIVE_CODE_AGENTS_HOME;
  delete process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE;
  process.env.PATH = originalPath;
  for (const key of providerEnvKeys) {
    const original = originalProviderEnv.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("executeCodeAgentRun", () => {
  it("runs a file-backed Agent-Native Code session with a fake engine", async () => {
    useTempCodeAgentsHome();
    process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE =
      "I checked the workspace and found the issue.";
    const output = createStringOutput();
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Fix auth tests",
      status: "queued",
      cwd: process.cwd(),
    });

    await executeCodeAgentRun({
      runId: run.id,
      prompt: "fix auth tests",
      stdout: output.stream,
    });

    const updated = getCodeAgentRunRecord(run.id);
    expect(updated).toMatchObject({
      status: "completed",
      phase: "complete",
      progress: { completed: 1, total: 1, percent: 100 },
    });
    expect(output.read()).toContain("I checked the workspace");
    expect(
      listCodeAgentTranscriptEvents(run.id).map((event) => event.kind),
    ).toEqual(["user", "status", "system", "status"]);
  });

  it("pauses with a credential hint when no provider key is available", async () => {
    useTempCodeAgentsHome();
    for (const key of providerEnvKeys) delete process.env[key];
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Fix auth tests",
      status: "queued",
      cwd: process.cwd(),
    });

    await executeCodeAgentRun({ runId: run.id, prompt: "fix auth tests" });

    const updated = getCodeAgentRunRecord(run.id);
    expect(updated).toMatchObject({
      status: "paused",
      phase: "missing-credentials",
      needsApproval: false,
    });
    expect(listCodeAgentTranscriptEvents(run.id).at(-1)?.message).toContain(
      "No LLM provider key was found",
    );
  });

  it("runs a Codex CLI-backed session without provider API keys", async () => {
    const root = useTempCodeAgentsHome();
    for (const key of providerEnvKeys) delete process.env[key];
    const binDir = path.join(root, "bin");
    const promptPath = path.join(root, "codex-prompt.txt");
    fs.mkdirSync(binDir, { recursive: true });
    const codexBin = path.join(binDir, "codex");
    fs.writeFileSync(
      codexBin,
      [
        "#!/usr/bin/env node",
        "const fs = require('fs');",
        "const args = process.argv.slice(2);",
        "const outIndex = args.indexOf('--output-last-message');",
        "const outPath = outIndex === -1 ? '' : args[outIndex + 1];",
        "let input = '';",
        "process.stdin.on('data', (chunk) => { input += chunk.toString(); });",
        "process.stdin.on('end', () => {",
        `  fs.writeFileSync(${JSON.stringify(promptPath)}, input);`,
        "  if (outPath) fs.writeFileSync(outPath, 'Codex final answer');",
        "  process.stdout.write('Codex streamed output');",
        "});",
      ].join("\n"),
      { mode: 0o755 },
    );
    process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
    const output = createStringOutput();
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Use Codex",
      status: "queued",
      cwd: process.cwd(),
      metadata: { engine: "codex-cli", model: "codex-cli" },
    });

    await executeCodeAgentRun({
      runId: run.id,
      prompt: "fix auth tests",
      stdout: output.stream,
    });

    expect(getCodeAgentRunRecord(run.id)).toMatchObject({
      status: "completed",
      phase: "complete",
      metadata: {
        engine: "codex-cli",
        model: "codex-default",
      },
    });
    expect(output.read()).toContain("Codex streamed output");
    expect(fs.readFileSync(promptPath, "utf-8")).toContain("fix auth tests");
    expect(listCodeAgentTranscriptEvents(run.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "system",
          message: "Codex final answer",
          metadata: expect.objectContaining({ engine: "codex-cli" }),
        }),
      ]),
    );
  });

  it("can execute a run whose initial prompt was written by Desktop", async () => {
    useTempCodeAgentsHome();
    process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE = "Desktop run done.";
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Desktop task",
      status: "queued",
      cwd: process.cwd(),
    });
    fs.mkdirSync(path.dirname(codeAgentRunTranscriptPath(run.id)), {
      recursive: true,
    });
    fs.appendFileSync(
      codeAgentRunTranscriptPath(run.id),
      `${JSON.stringify({
        schemaVersion: 1,
        id: "desktop-event-1",
        runId: run.id,
        type: "user",
        text: "fix desktop-started run",
        createdAt: new Date().toISOString(),
      })}\n`,
    );
    const output = createStringOutput();

    await executeCodeAgentRun({
      runId: run.id,
      appendUserEvent: false,
      stdout: output.stream,
    });

    expect(getCodeAgentRunRecord(run.id)).toMatchObject({
      status: "completed",
      phase: "complete",
    });
    expect(output.read()).toContain("Desktop run done.");
    expect(listCodeAgentTranscriptEvents(run.id)[0]).toMatchObject({
      kind: "user",
      message: "fix desktop-started run",
    });
  });

  it("records the run mode during execution", async () => {
    useTempCodeAgentsHome();
    process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE = "Permission noted.";
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Explain repo",
      permissionMode: "read-only",
      status: "queued",
      cwd: process.cwd(),
    });

    await executeCodeAgentRun({
      runId: run.id,
      prompt: "explain repo",
    });

    expect(getCodeAgentRunRecord(run.id)).toMatchObject({
      status: "completed",
      metadata: {
        permissionMode: "read-only",
      },
    });
  });

  it("exposes the shared minimal coding tools to the Code CLI executor", async () => {
    useTempCodeAgentsHome();
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Inspect tool surface",
      status: "queued",
      cwd: process.cwd(),
      permissionMode: "full-auto",
    });
    let toolNames: string[] = [];
    const engine = createToolCaptureEngine((names) => {
      toolNames = names;
    });

    await executeCodeAgentRun({
      runId: run.id,
      prompt: "inspect tools",
      engine,
    });

    expect(toolNames).toEqual(
      expect.arrayContaining(["bash", "read", "edit", "write"]),
    );
    expect(toolNames).toEqual(expect.arrayContaining(["tool-search"]));
    expect(toolNames).not.toEqual(
      expect.arrayContaining([
        "list_files",
        "search_files",
        "read_file",
        "write_file",
        "apply_patch",
        "run_command",
      ]),
    );
  });

  it("runs pending follow-ups after the current execution completes", async () => {
    useTempCodeAgentsHome();
    process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE = "Turn done.";
    const output = createStringOutput();
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Active task",
      status: "running",
      phase: "executing",
      cwd: process.cwd(),
    });
    queueCodeAgentFollowUp({
      runId: run.id,
      prompt: "follow up after completion",
      mode: "queued",
      source: "test",
    });

    await executeCodeAgentRun({
      runId: run.id,
      prompt: "finish current work",
      stdout: output.stream,
    });

    const updated = getCodeAgentRunRecord(run.id);
    const events = listCodeAgentTranscriptEvents(run.id);
    expect(updated).toMatchObject({
      status: "completed",
      phase: "complete",
    });
    expect(updated?.metadata?.pendingFollowUps).toBeUndefined();
    expect(output.read().match(/Turn done\./g)).toHaveLength(2);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "status",
          message: "Agent-Native Code run completed; running queued follow-up.",
        }),
      ]),
    );
  });

  it("executes a legacy run_command pending approval and clears it", async () => {
    const root = useTempCodeAgentsHome();
    const cwd = path.join(root, "repo");
    const target = path.join(cwd, "approval-target");
    fs.mkdirSync(target, { recursive: true });
    const run = createCodeAgentRunRecord({
      goalId: "task",
      title: "Approved cleanup",
      status: "needs-approval",
      phase: "approval-required",
      needsApproval: true,
      cwd,
    });
    updateCodeAgentRunRecord(run.id, {
      metadata: {
        pendingApproval: {
          id: "approval-test",
          tool: "run_command",
          command: "rm -rf approval-target",
          reason: "destructive recursive delete",
          requestedAt: new Date().toISOString(),
          permissionMode: "ask-before-edit",
        },
      },
    });
    const output = createStringOutput();

    await executePendingCodeAgentApproval(run.id, { stdout: output.stream });

    const updated = getCodeAgentRunRecord(run.id);
    // The approved command should have run.
    expect(fs.existsSync(target)).toBe(false);
    // Approval metadata is always recorded regardless of auto-resume outcome.
    expect(updated?.metadata?.lastApproval).toMatchObject({
      id: "approval-test",
      exitCode: 0,
    });
    // pendingApproval must be cleared.
    expect(updated?.metadata?.pendingApproval).toBeUndefined();
    // After approval, the run auto-resumes. In the test environment there is
    // no LLM provider, so the resumed run terminates with missing-credentials.
    // Verify it progressed past approval (not stuck in needs-approval).
    expect(updated?.status).not.toBe("needs-approval");
    expect(output.read()).toContain("Approved command finished");
  });
});

describe("classifyCodeAgentCommandPermission", () => {
  it("allows read-only inspection commands", () => {
    expect(classifyCodeAgentCommandPermission("git status --short")).toEqual({
      kind: "read",
    });
    expect(classifyCodeAgentCommandPermission("rg button src")).toEqual({
      kind: "read",
    });
  });

  it("does not classify shell redirection or compound commands as read-only", () => {
    expect(classifyCodeAgentCommandPermission("git diff > notes.txt")).toEqual({
      kind: "write",
    });
    expect(
      classifyCodeAgentCommandPermission("rg button; node -e '1'"),
    ).toEqual({
      kind: "write",
    });
  });

  it("classifies file-writing commands as write operations", () => {
    expect(classifyCodeAgentCommandPermission("echo hi > notes.txt")).toEqual({
      kind: "write",
    });
    expect(classifyCodeAgentCommandPermission("pnpm add left-pad")).toEqual({
      kind: "write",
    });
  });

  it("blocks forbidden git commands and requests approval for destructive commands", () => {
    expect(
      classifyCodeAgentCommandPermission("git reset --hard"),
    ).toMatchObject({ kind: "forbidden" });
    expect(classifyCodeAgentCommandPermission("rm -rf dist")).toMatchObject({
      kind: "approval-required",
    });
  });
});

function createStringOutput(): {
  stream: Writable;
  read: () => string;
} {
  let text = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  return {
    stream,
    read: () => text,
  };
}

function createToolCaptureEngine(
  onTools: (names: string[]) => void,
): AgentEngine {
  return {
    name: "tool-capture",
    label: "Tool Capture",
    defaultModel: "tool-capture",
    supportedModels: ["tool-capture"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    async *stream(opts) {
      onTools(opts.tools.map((tool) => tool.name));
      yield {
        type: "assistant-content",
        parts: [{ type: "text", text: "done" }],
      };
      yield { type: "stop", reason: "end_turn" };
    },
  };
}

function useTempCodeAgentsHome(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-code-exec-"));
  tmpRoots.push(root);
  process.env.AGENT_NATIVE_CODE_AGENTS_HOME = path.join(root, "code-agents");
  return root;
}

// ---------------------------------------------------------------------------
// buildStructuredMessagesFromEvents unit tests
// ---------------------------------------------------------------------------

describe("buildStructuredMessagesFromEvents", () => {
  function event(
    id: string,
    kind: CodeAgentTranscriptEvent["kind"],
    message: string,
    metadata?: Record<string, unknown>,
  ): CodeAgentTranscriptEvent {
    return {
      schemaVersion: 1,
      id,
      runId: "run-test",
      kind,
      message,
      createdAt: `2026-06-01T00:00:${id.length.toString().padStart(2, "0")}.000Z`,
      metadata,
    };
  }

  it("maps a user event to a user message", () => {
    const events = [event("e1", "user", "hello world")];
    const msgs = buildStructuredMessagesFromEvents(events);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ role: "user" });
    const textPart = msgs[0].content.find(
      (p: EngineContentPart) => p.type === "text",
    );
    expect(textPart).toMatchObject({ type: "text", text: "hello world" });
  });

  it("maps a system assistant event to an assistant message", () => {
    const events = [
      event("e1", "user", "fix it"),
      event("e2", "system", "I fixed it.", { role: "assistant" }),
    ];
    const msgs = buildStructuredMessagesFromEvents(events);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
    const textPart = msgs[1].content.find(
      (p: EngineContentPart) => p.type === "text",
    );
    expect(textPart).toMatchObject({ type: "text", text: "I fixed it." });
  });

  it("pairs tool_start and tool_done into assistant tool-call + user tool-result", () => {
    const events = [
      event("e1", "user", "run tests"),
      event("e2", "status", "Running bash.", {
        type: "tool_start",
        tool: "bash",
        input: { command: "pnpm test" },
      }),
      event("e3", "status", "Finished bash.", {
        type: "tool_done",
        tool: "bash",
        result: "All tests passed.",
      }),
      event("e4", "system", "Tests passed.", { role: "assistant" }),
    ];

    const msgs = buildStructuredMessagesFromEvents(events);

    // user, assistant (tool-call), user (tool-result), assistant (text)
    expect(msgs).toHaveLength(4);
    expect(msgs[0].role).toBe("user");

    expect(msgs[1].role).toBe("assistant");
    const toolCallPart = msgs[1].content.find(
      (p: EngineContentPart) => p.type === "tool-call",
    );
    expect(toolCallPart).toMatchObject({
      type: "tool-call",
      name: "bash",
    });
    expect((toolCallPart as { id: string }).id).toMatch(/^tc-/);

    expect(msgs[2].role).toBe("user");
    const toolResultPart = msgs[2].content.find(
      (p: EngineContentPart) => p.type === "tool-result",
    );
    expect(toolResultPart).toMatchObject({
      type: "tool-result",
      toolName: "bash",
      content: "All tests passed.",
    });
    // toolCallId must match the id from the tool-call part
    expect((toolResultPart as { toolCallId: string }).toolCallId).toBe(
      (toolCallPart as { id: string }).id,
    );

    expect(msgs[3].role).toBe("assistant");
  });

  it("merges consecutive same-role messages", () => {
    const events = [
      event("e1", "user", "first"),
      event("e2", "user", "second"),
    ];
    const msgs = buildStructuredMessagesFromEvents(events);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toHaveLength(2);
  });

  it("excludes thinking events from history", () => {
    const events = [
      event("e1", "user", "think"),
      event("e2", "status", "Reasoning about the problem...", {
        type: "thinking",
      }),
      event("e3", "system", "Answer.", { role: "assistant" }),
    ];
    const msgs = buildStructuredMessagesFromEvents(events);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
    // No content from thinking event
    const allText = msgs
      .flatMap((m) => m.content)
      .filter((p: EngineContentPart) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join(" ");
    expect(allText).not.toContain("Reasoning about");
  });

  it("falls back to plain text for orphaned tool_done with no matching start", () => {
    const events = [
      event("e1", "status", "Finished bash.", {
        type: "tool_done",
        tool: "bash",
        result: "output here",
      }),
    ];
    const msgs = buildStructuredMessagesFromEvents(events);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
    const textPart = msgs[0].content.find(
      (p: EngineContentPart) => p.type === "text",
    );
    expect((textPart as { text: string }).text).toContain("output here");
  });

  it("truncates long tool results to the result cap", () => {
    const longResult = "x".repeat(100_000);
    const events = [
      event("e1", "status", "Running read.", {
        type: "tool_start",
        tool: "read",
        input: { path: "big.ts" },
      }),
      event("e2", "status", "Finished read.", {
        type: "tool_done",
        tool: "read",
        result: longResult,
      }),
    ];
    const msgs = buildStructuredMessagesFromEvents(events);
    const toolResultPart = msgs
      .flatMap((m) => m.content)
      .find((p: EngineContentPart) => p.type === "tool-result");
    expect((toolResultPart as { content: string }).content.length).toBeLessThan(
      longResult.length,
    );
  });

  it("handles malformed events without throwing", () => {
    // Events with missing or null metadata
    const events = [
      event("e1", "status", "no type in metadata", {}),
      event("e2", "status", "null metadata"),
    ];
    expect(() => buildStructuredMessagesFromEvents(events)).not.toThrow();
    const msgs = buildStructuredMessagesFromEvents(events);
    // Neither event maps to a user/assistant message
    expect(msgs).toHaveLength(0);
  });

  it("handles multiple tool call/result pairs in sequence", () => {
    const events = [
      event("e1", "user", "do two things"),
      event("e2", "status", "Running bash.", {
        type: "tool_start",
        tool: "bash",
        input: { command: "ls" },
      }),
      event("e3", "status", "Finished bash.", {
        type: "tool_done",
        tool: "bash",
        result: "file1.ts",
      }),
      event("e4", "status", "Running read.", {
        type: "tool_start",
        tool: "read",
        input: { path: "file1.ts" },
      }),
      event("e5", "status", "Finished read.", {
        type: "tool_done",
        tool: "read",
        result: "const x = 1;",
      }),
    ];

    const msgs = buildStructuredMessagesFromEvents(events);
    // user, assistant(bash call), user(bash result), assistant(read call), user(read result)
    expect(msgs).toHaveLength(5);

    const bashCall = msgs[1].content.find(
      (p: EngineContentPart) => p.type === "tool-call",
    ) as { id: string; name: string } | undefined;
    const bashResult = msgs[2].content.find(
      (p: EngineContentPart) => p.type === "tool-result",
    ) as { toolCallId: string; toolName: string; content: string } | undefined;
    expect(bashCall?.name).toBe("bash");
    expect(bashResult?.toolName).toBe("bash");
    expect(bashResult?.content).toContain("file1.ts");
    expect(bashResult?.toolCallId).toBe(bashCall?.id);

    const readCall = msgs[3].content.find(
      (p: EngineContentPart) => p.type === "tool-call",
    ) as { id: string; name: string } | undefined;
    const readResult = msgs[4].content.find(
      (p: EngineContentPart) => p.type === "tool-result",
    ) as { toolCallId: string; toolName: string } | undefined;
    expect(readCall?.name).toBe("read");
    expect(readResult?.toolCallId).toBe(readCall?.id);
  });
});

// ---------------------------------------------------------------------------
// buildRepoInstructionsBlock + buildCodeAgentSystemPrompt unit tests
// ---------------------------------------------------------------------------

describe("buildRepoInstructionsBlock", () => {
  it("returns empty string when content is empty", () => {
    expect(buildRepoInstructionsBlock("")).toBe("");
    expect(buildRepoInstructionsBlock("   ")).toBe("");
  });

  it("wraps content under a Repository instructions heading", () => {
    const result = buildRepoInstructionsBlock("Always use TypeScript.");
    expect(result).toContain("## Repository instructions");
    expect(result).toContain("Always use TypeScript.");
  });

  it("truncates content longer than 16,000 characters with a note", () => {
    const longContent = "x".repeat(20_000);
    const result = buildRepoInstructionsBlock(longContent);
    expect(result.length).toBeLessThan(longContent.length);
    expect(result).toContain(
      "[Note: AGENTS.md was truncated to 16000 characters",
    );
  });

  it("does not truncate content under the cap", () => {
    const shortContent = "y".repeat(100);
    const result = buildRepoInstructionsBlock(shortContent);
    expect(result).not.toContain("[Note:");
    expect(result).toContain(shortContent);
  });
});

describe("buildCodeAgentSystemPrompt", () => {
  it("inlines AGENTS.md content when the file exists in cwd", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-prompt-agents-"));
    tmpRoots.push(root);
    fs.writeFileSync(
      path.join(root, "AGENTS.md"),
      "Always run pnpm typecheck before committing.",
    );

    const prompt = await buildCodeAgentSystemPrompt(root, "full-auto");

    expect(prompt).toContain("## Repository instructions");
    expect(prompt).toContain("Always run pnpm typecheck before committing.");
  });

  it("falls back to CLAUDE.md when AGENTS.md is absent", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-prompt-claude-"));
    tmpRoots.push(root);
    fs.writeFileSync(
      path.join(root, "CLAUDE.md"),
      "Project-specific Claude instructions.",
    );

    const prompt = await buildCodeAgentSystemPrompt(root, "full-auto");

    expect(prompt).toContain("## Repository instructions");
    expect(prompt).toContain("Project-specific Claude instructions.");
  });

  it("omits the repo instructions section when neither AGENTS.md nor CLAUDE.md exists", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-prompt-empty-"));
    tmpRoots.push(root);

    const prompt = await buildCodeAgentSystemPrompt(root, "full-auto");

    expect(prompt).not.toContain("## Repository instructions");
  });

  it("inlines a skills index when .agents/skills/ skills exist", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-prompt-skills-"));
    tmpRoots.push(root);
    const skillDir = path.join(root, ".agents", "skills", "my-feature");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: my-feature",
        "description: Explains how to add new features.",
        "---",
        "# My Feature Skill",
      ].join("\n"),
    );

    const prompt = await buildCodeAgentSystemPrompt(root, "full-auto");

    expect(prompt).toContain("my-feature");
    expect(prompt).toContain("Explains how to add new features.");
    expect(prompt).toContain("SKILL.md");
  });

  it("omits skills section when no skills directory exists", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-prompt-noskills-"));
    tmpRoots.push(root);

    const prompt = await buildCodeAgentSystemPrompt(root, "full-auto");

    expect(prompt).not.toContain("<skills>");
  });

  it("includes nested AGENTS.md precedence note in every prompt", () => {
    const prompt = codeAgentSystemPrompt("/tmp/repo", "full-auto");
    expect(prompt).toContain(
      "More deeply nested AGENTS.md files take precedence",
    );
  });

  it("caps truncated AGENTS.md and adds a note", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-prompt-cap-"));
    tmpRoots.push(root);
    fs.writeFileSync(path.join(root, "AGENTS.md"), "z".repeat(20_000));

    const prompt = await buildCodeAgentSystemPrompt(root, "full-auto");

    expect(prompt).toContain(
      "[Note: AGENTS.md was truncated to 16000 characters",
    );
  });
});
