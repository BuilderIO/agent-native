import { resolveConnectorSecret } from "../connectors/credentials.js";

export interface BuilderExecutorInput {
  runId: string;
  itemId: string;
  ownerEmail: string;
  orgId: string;
  repository?: string | null;
  summary?: string | null;
  sourceUrl?: string | null;
  instructions?: string | null;
}

export interface BuilderExecutorResult {
  providerTaskId?: string;
  branchName: string;
}

function requiredEnv(
  name: "BUILDER_AI_SERVICES_URL" | "BUILDER_PROJECT_ID" | "FACTORY_PUBLIC_URL",
): string {
  const value =
    name === "BUILDER_AI_SERVICES_URL"
      ? process.env.BUILDER_AI_SERVICES_URL // guard:allow-env-credential - non-secret deployment endpoint
      : name === "BUILDER_PROJECT_ID"
        ? process.env.BUILDER_PROJECT_ID // guard:allow-env-credential - non-secret deployment project id
        : process.env.FACTORY_PUBLIC_URL; // guard:allow-env-credential - public callback origin
  if (!value) throw new Error(`${name} is required for the Builder executor.`);
  return value;
}

function publicCallbackUrl(runId: string): string {
  const base = requiredEnv("FACTORY_PUBLIC_URL").replace(/\/$/, "");
  return `${base}/_agent-native/factory/builder-callback?runId=${encodeURIComponent(runId)}`;
}

export async function startBuilderRun(
  input: BuilderExecutorInput,
): Promise<BuilderExecutorResult> {
  const baseUrl = requiredEnv("BUILDER_AI_SERVICES_URL").replace(/\/$/, "");
  const projectId = requiredEnv("BUILDER_PROJECT_ID");
  const privateKey = await resolveConnectorSecret(
    "BUILDER_PRIVATE_KEY",
    input.ownerEmail,
    {
      orgId: input.orgId,
    },
  );
  if (!privateKey) {
    throw new Error(
      "No Builder executor credential configured. Connect the Builder service in workspace settings or configure BUILDER_PRIVATE_KEY through the workspace resolver.",
    );
  }
  const webhookSecret = await resolveConnectorSecret(
    "FACTORY_BUILDER_WEBHOOK_SECRET",
    input.ownerEmail,
    { orgId: input.orgId },
  );
  if (!webhookSecret)
    throw new Error(
      "FACTORY_BUILDER_WEBHOOK_SECRET is required for signed callbacks.",
    );

  const branchName = `factory/${input.itemId.slice(0, 12)}`;
  const prompt = [
    "Work on this approved Factory item.",
    `Factory item: ${input.itemId}`,
    input.summary
      ? `Feedback: ${input.summary}`
      : "No feedback summary was supplied.",
    input.sourceUrl ? `Source: ${input.sourceUrl}` : "",
    input.repository ? `Repository: ${input.repository}` : "",
    input.instructions ? `Triage instructions: ${input.instructions}` : "",
    "Run /address-feedback in the repository and read the address-feedback, address-feedback-with-replies, review-latest-feedback, and review-prs skills as relevant. Search for repeat reports, fix the smallest owning boundary, and verify the full path before opening the pull request.",
    "Inspect the repository, make the smallest safe fix, run validation, and open a pull request.",
    "Include the Factory item id and source link in the pull request description.",
    "Do not touch protected areas: auth/session/identity, credentials/vault, migrations, payments, security, or publishable packages.",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch(`${baseUrl}/projects/branch/message`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${privateKey.startsWith("bpk-") ? privateKey : `bpk-${privateKey}`}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      projectId,
      branchName,
      userMessage: {
        userPrompt: prompt,
        runValidateCommand: true,
        queue: true,
      },
      fireAndForget: true,
      webhook: { url: publicCallbackUrl(input.runId), secret: webhookSecret },
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Builder executor rejected the run: HTTP ${response.status} ${await response.text()}`,
    );
  }
  let payload: {
    id?: string;
    taskId?: string;
    runId?: string;
  };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new Error("Builder executor returned invalid JSON.");
  }
  const providerTaskId = payload.id ?? payload.taskId ?? payload.runId;
  if (!providerTaskId) {
    throw new Error("Builder executor response did not include a task id.");
  }
  return {
    providerTaskId,
    branchName,
  };
}
