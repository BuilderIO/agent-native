import { defineAction } from "@agent-native/core";
import { getWorkspaceConnectionProvider } from "@agent-native/core/connections";
import { z } from "zod";

import upsertWorkspaceConnection from "./upsert-workspace-connection.js";

const statusSchema = z.enum([
  "connected",
  "checking",
  "needs_reauth",
  "error",
  "disabled",
]);

const credentialRefSchema = z
  .object({
    key: z.string().describe("Vault or OAuth credential reference name."),
    scope: z.enum(["user", "org", "workspace"]).optional(),
    provider: z.string().optional(),
    label: z.string().optional(),
  })
  .strict();

const RAW_SECRET_PATTERNS = [
  /^xox[a-z]-/i,
  /^github_pat_/i,
  /^gh[opsu]_/i,
  /^sk-[a-z0-9_-]{16,}/i,
  /^AIza[0-9A-Za-z_-]{20,}/,
  /^ya29\./,
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
];

function uniqueStrings(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function assertSafeCredentialRefKey(key: string) {
  const value = key.trim();
  if (!value) return;
  if (
    value.length > 120 ||
    RAW_SECRET_PATTERNS.some((pattern) => pattern.test(value))
  ) {
    throw new Error(
      `Credential ref "${value.slice(
        0,
        12,
      )}..." looks like a raw secret. Store the secret in Vault or OAuth and use only the ref name here.`,
    );
  }
}

export default defineAction({
  description:
    "Apply a planned workspace integration setup or repair using credential reference names only.",
  schema: z.object({
    connectionId: z
      .string()
      .optional()
      .describe("Existing connection ID to update."),
    provider: z
      .string()
      .describe("Provider ID from the workspace connection provider catalog."),
    label: z.string().optional(),
    accountId: z.string().nullable().optional(),
    accountLabel: z.string().nullable().optional(),
    status: statusSchema.default("connected"),
    scopes: z.array(z.string()).default([]),
    credentialRefs: z.array(credentialRefSchema).default([]),
    grantMode: z.enum(["all-apps", "selected-apps"]).default("selected-apps"),
    selectedApps: z.array(z.string()).default([]),
  }),
  run: async (args) => {
    const provider = getWorkspaceConnectionProvider(args.provider);
    if (!provider) {
      throw new Error(
        `Unknown workspace connection provider "${args.provider}". Use list-workspace-connections to see valid provider IDs.`,
      );
    }

    const credentialRefs = args.credentialRefs.map((ref) => {
      assertSafeCredentialRefKey(ref.key);
      const key = ref.key.trim();
      return {
        key,
        scope: ref.scope ?? "org",
        provider: ref.provider?.trim() || provider.id,
        label:
          ref.label?.trim() ||
          provider.credentialKeys.find((credential) => credential.key === key)
            ?.label ||
          key,
      };
    });
    const availableRefs = new Set(credentialRefs.map((ref) => ref.key));
    const missingRequiredRefs = provider.credentialKeys
      .filter((credential) => credential.required)
      .map((credential) => credential.key)
      .filter((key) => !availableRefs.has(key));

    if (missingRequiredRefs.length > 0) {
      throw new Error(
        `Required credential refs are missing: ${missingRequiredRefs.join(
          ", ",
        )}.`,
      );
    }

    const allowedApps =
      args.grantMode === "all-apps" ? [] : uniqueStrings(args.selectedApps);
    if (args.grantMode === "selected-apps" && allowedApps.length === 0) {
      throw new Error("Choose at least one app or switch access to all apps.");
    }

    return upsertWorkspaceConnection.run({
      id: args.connectionId,
      provider: provider.id,
      label: args.label?.trim() || provider.label,
      accountId: args.accountId?.trim() || null,
      accountLabel: args.accountLabel?.trim() || null,
      status: args.status,
      scopes: uniqueStrings(args.scopes),
      credentialRefs,
      allowedApps,
    });
  },
});
