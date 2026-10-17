import { defineAction } from "@agent-native/core/action";
import { getOwnerJevApiKey } from "@agent-native/core/server";
import { z } from "zod";

import { UserInputError } from "../server/errors.js";
import { DEFAULT_QUEUES, findQueueField } from "../server/task-routing.js";
import { getTask, requireUserEmail } from "../server/tasks/store.js";

const jevAnswerSchema = z.object({
  answers: z.object({
    queue: z.object({
      choice: z.string(),
      confidence: z.number().min(0).max(1),
      probabilities: z.record(z.string(), z.number().min(0).max(1)),
    }),
    urgent: z.object({ noul: z.number().min(0).max(1) }),
  }),
});

export default defineAction({
  description:
    "Suggest a queue and urgency for a task using the existing Queue field or default queues. This does not change the task; use apply-task-route after review.",
  schema: z.object({ taskId: z.string().describe("Task id to classify") }),
  readOnly: true,
  run: async ({ taskId }, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    const task = await getTask({ ownerEmail, id: taskId });
    if (!task) throw new UserInputError("Task not found.");
    const field = await findQueueField(ownerEmail);

    const apiKey = await getOwnerJevApiKey(ownerEmail);
    if (!apiKey)
      throw new Error("Connect a Jev API key to use AI task routing.");

    const options =
      field?.config.options.map(({ name }) => name) ?? DEFAULT_QUEUES;
    const criteria = Object.fromEntries(
      options.map((name, index) => [`queue_${index}`, name]),
    );
    criteria.none = "No queue matches or the task title lacks enough context";
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "jev-latest",
        state: {
          task: { title: task.title },
          queues: options,
        },
        questions: {
          queue: {
            type: "choice",
            instructions:
              "Which queue best fits `task.title`? Choose none when the title does not support a specific queue.",
            criteria,
          },
          urgent: {
            type: "noul",
            instructions:
              "Does `task.title` indicate that this task needs urgent attention now?",
            criteria: {
              true: "An explicit near deadline or serious immediate impact",
              false: "No stated urgency or only routine priority",
            },
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Jev task routing failed (HTTP ${response.status}).`);
    }

    const { answers } = jevAnswerSchema.parse(await response.json());
    const selectedIndex = /^queue_(\d+)$/.exec(answers.queue.choice);
    const option = selectedIndex
      ? options[Number(selectedIndex[1])]
      : undefined;
    if (answers.queue.choice !== "none" && !option) {
      throw new Error("Jev returned an unknown queue.");
    }
    const selectedProbability =
      answers.queue.probabilities[answers.queue.choice];
    if (selectedProbability === undefined) {
      throw new Error("Jev returned no probability for the selected queue.");
    }

    return {
      taskId,
      queue: option ?? null,
      queueProbability: selectedProbability,
      queueConfidence: answers.queue.confidence,
      urgentProbability: answers.urgent.noul,
    };
  },
});
