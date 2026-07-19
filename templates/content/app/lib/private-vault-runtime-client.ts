import { agentNativePath } from "@agent-native/core/client/api-path";
import { z } from "zod";

const runtimeSchema = z
  .object({
    version: z.literal(1),
    suite: z.literal("anc/v1"),
    state: z.literal("active"),
    vaultId: z.string().regex(/^[0-9a-f]{32}$/),
    head: z
      .object({
        sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        hash: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict(),
  })
  .strict();

export type PrivateVaultBrowserStatus =
  | { state: "absent" }
  | { state: "active"; vaultId: string; sequence: number };

export async function getPrivateVaultBrowserStatus(
  options: { signal?: AbortSignal } = {},
): Promise<PrivateVaultBrowserStatus> {
  const response = await fetch(agentNativePath("/api/private-vault/runtime"), {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal: options.signal,
    headers: { Accept: "application/json", "X-Agent-Native-CSRF": "1" },
  });
  if (response.status === 404) return { state: "absent" };
  if (
    !response.ok ||
    response.headers.get("content-type") !== "application/json"
  )
    throw new Error("Private Vault status unavailable");
  const parsed = runtimeSchema.parse(await response.json());
  return {
    state: "active",
    vaultId: parsed.vaultId,
    sequence: parsed.head.sequence,
  };
}
