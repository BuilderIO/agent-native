import {
  createProductionAgentHandler,
  defineAppConfig,
  getAppConfig,
  getRequestRunContext,
  resetAppConfigForTests,
  runWithRequestContext,
  type ActionEntry,
} from "@agent-native/core/server";
import { mockEvent } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DESIGN_INTAKE_QUESTION_TOOL_NAMES,
  DESIGN_NO_QUESTIONS_INSTRUCTIONS,
  applyDesignFirstPromptIntakePolicy,
  designFirstPromptIntakeInstructions,
  guardDesignFirstPromptActions,
  isDesignFirstPromptNoQuestionsEnabled,
} from "./first-prompt-intake.js";

type TestEngine = Extract<
  NonNullable<Parameters<typeof createProductionAgentHandler>[0]["engine"]>,
  { stream: (...args: never[]) => unknown }
>;

function createAction(run: ActionEntry["run"]): ActionEntry {
  return {
    tool: {
      description: "test action",
      parameters: { type: "object", properties: {} },
    },
    run,
  };
}

function createCaptureEngine() {
  const captured: Array<{ systemPrompt: string; toolNames: string[] }> = [];
  const engine: TestEngine = {
    name: "test",
    label: "Test",
    defaultModel: "test-model",
    supportedModels: ["test-model"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    async *stream(opts) {
      captured.push({
        systemPrompt: opts.systemPrompt,
        toolNames: opts.tools.map((tool) => tool.name),
      });
      yield {
        type: "assistant-content",
        parts: [{ type: "text", text: "Generated." }],
      };
      yield { type: "stop", reason: "end_turn" };
    },
  };
  return { engine, captured };
}

async function drainResponse(response: unknown): Promise<void> {
  if (!(response instanceof ReadableStream)) return;
  const reader = response.getReader();
  while (!(await reader.read()).done) {}
}

function firstItem<T>(items: readonly T[]): T {
  const first = items.values().next();
  if (first.done) {
    throw new Error("Expected at least one captured engine call");
  }
  return first.value;
}

describe("Design first-prompt intake graduation", () => {
  afterEach(() => {
    delete process.env.DESIGN_SKIP_FIRST_PROMPT_QUESTIONS;
    delete process.env.AGENT_QUESTION_INTAKE_EXPERIMENT_ENABLED;
    delete process.env.AGENT_QUESTION_INTAKE_EXPERIMENT_DISABLED;
    resetAppConfigForTests();
    vi.resetModules();
  });

  it("graduates Design out of the design_no_questions experiment config", async () => {
    process.env.AGENT_QUESTION_INTAKE_EXPERIMENT_ENABLED = "true";
    resetAppConfigForTests();
    await import("../plugins/config.js");

    expect(getAppConfig().agent.questionIntake).toBeUndefined();
    expect(isDesignFirstPromptNoQuestionsEnabled()).toBe(true);
  });

  it("defaults to skipping intake questions and honors env and app-config overrides", () => {
    expect(isDesignFirstPromptNoQuestionsEnabled()).toBe(true);
    expect(designFirstPromptIntakeInstructions()).toContain(
      DESIGN_NO_QUESTIONS_INSTRUCTIONS,
    );

    process.env.DESIGN_SKIP_FIRST_PROMPT_QUESTIONS = "false";
    expect(isDesignFirstPromptNoQuestionsEnabled()).toBe(false);
    expect(designFirstPromptIntakeInstructions()).toBeNull();

    delete process.env.DESIGN_SKIP_FIRST_PROMPT_QUESTIONS;
    defineAppConfig({ designFirstPrompt: { skipIntakeQuestions: false } });
    expect(isDesignFirstPromptNoQuestionsEnabled()).toBe(false);
    expect(designFirstPromptIntakeInstructions()).toBeNull();
  });

  it("blocks wrapped show-design-questions across all callers when enabled and allows rollback", async () => {
    const showQuestionsRun = vi.fn().mockResolvedValue({ count: 3 });
    const generateRun = vi.fn().mockResolvedValue({ renderable: true });
    const actions = new Map(
      Object.entries(
        guardDesignFirstPromptActions({
          "show-design-questions": createAction(showQuestionsRun),
          "generate-design": createAction(generateRun),
        }),
      ),
    );

    const showQuestions = actions.get("show-design-questions");
    const generateDesign = actions.get("generate-design");
    expect(showQuestions).toBeDefined();
    expect(generateDesign).toBeDefined();
    if (!showQuestions || !generateDesign) {
      throw new Error("Expected wrapped actions to be registered");
    }

    for (const caller of [
      "tool",
      "cli",
      "automation",
      "mcp",
      "webmcp",
      "a2a",
    ] as const) {
      await expect(
        showQuestions.run({}, { caller, threadId: "thread-1" }),
      ).rejects.toThrow("Intake questions are disabled");
    }
    await expect(showQuestions.run({})).rejects.toThrow(
      "Intake questions are disabled",
    );
    expect(showQuestionsRun).not.toHaveBeenCalled();

    await expect(
      generateDesign.run({}, { caller: "tool", threadId: "thread-1" }),
    ).resolves.toEqual({ renderable: true });

    process.env.DESIGN_SKIP_FIRST_PROMPT_QUESTIONS = "false";
    await expect(
      showQuestions.run({}, { caller: "tool", threadId: "thread-1" }),
    ).resolves.toEqual({ count: 3 });
    await expect(showQuestions.run({}, { caller: "cli" })).resolves.toEqual({
      count: 3,
    });
    await expect(
      showQuestions.run({}, { caller: "automation", threadId: "thread-1" }),
    ).resolves.toEqual({ count: 3 });
  });

  it("preserves prior excludedActionNames when adding Design intake tools", async () => {
    await runWithRequestContext(
      {
        userEmail: "alice@example.com",
        run: { excludedActionNames: ["existing-excluded-tool"] },
      },
      () => {
        applyDesignFirstPromptIntakePolicy();
        expect(getRequestRunContext()?.excludedActionNames).toEqual([
          "existing-excluded-tool",
          ...DESIGN_INTAKE_QUESTION_TOOL_NAMES,
        ]);
      },
    );
  });

  it("excludes show-design-questions and injects instructions in agent runs without experiment attribution", async () => {
    const { engine, captured } = createCaptureEngine();
    const showQuestionsRun = vi.fn().mockResolvedValue({ count: 3 });
    const generateRun = vi.fn().mockResolvedValue({ renderable: true });
    const editRun = vi.fn().mockResolvedValue({ changed: true });

    const handler = createProductionAgentHandler({
      assertAiSetupReady: async () => {},
      appId: "design",
      systemPrompt: () => {
        const extra = designFirstPromptIntakeInstructions();
        return extra ? `Base Design prompt\n\n${extra}` : "Base Design prompt";
      },
      engine,
      prepareRequest: () => {
        applyDesignFirstPromptIntakePolicy();
      },
      actions: guardDesignFirstPromptActions({
        "show-design-questions": createAction(showQuestionsRun),
        "generate-design": createAction(generateRun),
        "edit-design": createAction(editRun),
      }),
    });

    const runChat = async (authUserId: string) => {
      const startIndex = captured.length;
      const event = mockEvent(
        new Request("http://design.example.com/_agent-native/agent-chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: "Design a clean SaaS billing dashboard",
          }),
        }),
      );
      let recordedAssignment: unknown;
      const response = await runWithRequestContext(
        {
          userEmail: `${authUserId}@example.com`,
          authUserId,
          run: {},
        },
        async () => {
          const res = await handler(event);
          recordedAssignment =
            getRequestRunContext()?.questionIntakeExperimentAssignment;
          return res;
        },
      );
      await drainResponse(response);
      return {
        assignment: recordedAssignment,
        calls: captured.slice(startIndex),
      };
    };

    const newUserRun = await runChat("new-user-1");
    const priorControlRun = await runChat("prior-control-user-2");

    expect(newUserRun.assignment).toBeUndefined();
    expect(priorControlRun.assignment).toBeUndefined();
    expect(newUserRun.calls.length).toBeGreaterThanOrEqual(1);
    expect(priorControlRun.calls.length).toBeGreaterThanOrEqual(1);
    for (const run of [newUserRun, priorControlRun]) {
      const mainTurn = firstItem(run.calls);
      expect(mainTurn.toolNames).not.toContain("show-design-questions");
      expect(mainTurn.toolNames).toContain("generate-design");
      expect(mainTurn.toolNames).toContain("edit-design");
      expect(mainTurn.systemPrompt).toContain(DESIGN_NO_QUESTIONS_INSTRUCTIONS);
      for (const call of run.calls) {
        expect(call.toolNames).not.toContain("show-design-questions");
      }
    }

    process.env.DESIGN_SKIP_FIRST_PROMPT_QUESTIONS = "false";
    const rollbackRun = await runChat("rollback-user-3");

    expect(rollbackRun.assignment).toBeUndefined();
    expect(rollbackRun.calls.length).toBeGreaterThanOrEqual(1);
    const rollbackTurn = firstItem(rollbackRun.calls);
    expect(rollbackTurn.toolNames).toContain("show-design-questions");
    expect(rollbackTurn.toolNames).toContain("generate-design");
    expect(rollbackTurn.systemPrompt).not.toContain(
      DESIGN_NO_QUESTIONS_INSTRUCTIONS,
    );
  });
});
