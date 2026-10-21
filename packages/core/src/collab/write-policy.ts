import { getDbExec, type DbExec } from "../db/client.js";

export type CollabWritePolicy = (tx: DbExec, docId: string) => Promise<void>;

const POLICIES_KEY = "__agentNativeCollabWritePolicies__";
const policyGlobal = globalThis as typeof globalThis & {
  [POLICIES_KEY]?: Map<string, CollabWritePolicy>;
};
const policies = (policyGlobal[POLICIES_KEY] ??= new Map());

/**
 * Checks app write policy in the transaction that stores collaborative state,
 * independently of live-copy eligibility. Lock app rows before checking them;
 * ignore document IDs outside this policy's app. A throw rolls back the write
 * and reaches its caller unchanged. A stable name replaces a prior declaration.
 */
export function defineCollabWritePolicy(
  name: string,
  policy: CollabWritePolicy,
): () => void {
  if (!name || typeof name !== "string" || typeof policy !== "function") {
    throw new TypeError(
      "A collaboration write policy needs a name and callback.",
    );
  }
  policies.set(name, policy);
  return () => {
    if (policies.get(name) === policy) policies.delete(name);
  };
}

export async function assertCollabWritePolicies(
  tx: DbExec,
  docId: string,
): Promise<void> {
  for (const policy of policies.values()) await policy(tx, docId);
}

export async function withCollabWriteTransaction<T>(
  run: (tx: DbExec) => Promise<T>,
): Promise<T> {
  const exec = getDbExec();
  if (policies.size === 0) return run(exec);
  if (!exec.transaction) {
    throw new Error(
      "Collaboration write policies require a transaction-capable executor.",
    );
  }
  return exec.transaction(run);
}
