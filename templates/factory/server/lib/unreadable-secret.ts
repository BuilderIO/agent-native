import { WorkflowActionError } from "./workflow-action-errors.js";

/**
 * The `errorCode` core puts on the error it throws for a saved secret this
 * deployment cannot decrypt: a database copied from another deployment, or a
 * rotated key. Core does not export the class, so it is read by this code.
 */
export const SECRET_UNREADABLE_CODE = "app_secret_unreadable";

export function isUnreadableSecret(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as { errorCode?: unknown }).errorCode === SECRET_UNREADABLE_CODE
  );
}

function unreadableMessage(keys: readonly string[]): string {
  const one = keys.length === 1;
  const them = one ? "it" : "them";
  return `${keys.join(", ")} ${one ? "is" : "are"} saved but this deployment cannot decrypt ${them}, so nothing that needs ${them} can run. The database may have been copied from another deployment, or its encryption key changed. Retrying will not help: a person must save ${them} again under Keys in Settings, or run with the key that saved ${them}.`;
}

/**
 * Keys that are saved but cannot be decrypted here. Waiting never heals them,
 * so this is no vault outage and carries no retry; they exist, so it is no
 * missing key and nothing in it says to connect. It names the keys and never a
 * value, and it carries core's code so every reader of that code sees it.
 */
export class UnreadableSecretError extends WorkflowActionError {
  readonly keys: readonly string[];
  cause?: unknown;

  constructor(keys: string | readonly string[], cause?: unknown) {
    const named = typeof keys === "string" ? [keys] : [...keys];
    super({
      message: unreadableMessage(named),
      errorCode: SECRET_UNREADABLE_CODE,
      statusCode: 412,
      details: { keys: named },
    });
    this.name = "UnreadableSecretError";
    this.keys = named;
    if (cause !== undefined) this.cause = cause;
  }
}
