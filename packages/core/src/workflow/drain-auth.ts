export type WorkflowDrainAuthorization =
  | "authorized"
  | "unauthorized"
  | "unconfigured";

async function digest(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", bytes),
  );
}

async function secretsEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([
    digest(left),
    digest(right),
  ]);
  let difference = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= leftDigest[index]! ^ rightDigest[index]!;
  }
  return difference === 0;
}

export async function authorizeWorkflowDrain(input: {
  scheduledRuntime: boolean;
  configuredSecret?: string;
  authorization?: string;
}): Promise<WorkflowDrainAuthorization> {
  if (input.scheduledRuntime) return "authorized";
  const secret = input.configuredSecret?.trim();
  if (!secret) return "unconfigured";
  return (await secretsEqual(
    input.authorization?.trim() ?? "",
    `Bearer ${secret}`,
  ))
    ? "authorized"
    : "unauthorized";
}
