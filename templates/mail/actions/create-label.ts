import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { buildDeepLink, getRequestUserEmail } from "@agent-native/core/server";
import { mutateUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  isSystemLabelName,
  normalizeLabel,
} from "../server/lib/email-label-change.js";
import { gmailCreateLabel, gmailListLabels } from "../server/lib/google-api.js";
import {
  getClientsWithErrors,
  isConnected,
} from "../server/lib/google-auth.js";
import { addCachedGmailLabel } from "../server/lib/inbox-store.js";
import type { Label } from "../shared/types.js";

const accountResultSchema = z.object({
  accountEmail: z.string(),
  status: z.enum(["created", "existing", "failed"]),
  error: z.string().optional(),
});

const createLabelOutputSchema = z.object({
  status: z.enum(["complete", "partial"]),
  backend: z.enum(["gmail", "local"]),
  label: z.object({
    id: z.string(),
    name: z.string(),
    type: z.literal("user"),
  }),
  accounts: z.array(accountResultSchema),
});

type CreateLabelAccountResult = z.infer<typeof accountResultSchema>;
export type CreateLabelResult = z.infer<typeof createLabelOutputSchema>;

function labelViewId(name: string): string {
  return name.toLowerCase().replace(/_/g, " ");
}

export default defineAction({
  description:
    "Create a Gmail label so it can be applied with label-email or move-email. Creates it in every connected Gmail account unless accountEmails narrows that, and reports per account whether it was created, already existed, or failed. An existing label with the same name is reused, not duplicated. Without a connected Gmail account it adds the label to the local synthetic mailbox only (backend: local).",
  schema: z.object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(225)
      .describe("Label name. Use / to nest, e.g. Clients/Acme"),
    accountEmails: z
      .array(z.string().email())
      .optional()
      .describe(
        "Connected Gmail accounts to create the label in; defaults to all",
      ),
  }),
  outputSchema: createLabelOutputSchema,
  mcpTool: "search",
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  link: ({ result }) => {
    const id = (result as Partial<CreateLabelResult> | undefined)?.label?.id;
    if (!id) return null;
    return {
      url: buildDeepLink({ app: "mail", view: "all", params: { label: id } }),
      label: "Open label in Mail",
      view: "all",
    };
  },
  run: async ({ name, accountEmails }): Promise<CreateLabelResult> => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      fail("no authenticated user", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    if (isSystemLabelName(name)) {
      fail(`"${name}" is a built-in Gmail label`, {
        errorCode: "label_name_reserved",
        statusCode: 400,
      });
    }
    const key = normalizeLabel(name);
    const label = { id: labelViewId(name), name, type: "user" as const };

    if (!(await isConnected(ownerEmail))) {
      let existing: Label | undefined;
      await mutateUserSetting(ownerEmail, "labels", (current) => {
        const labels: Label[] = Array.isArray(current?.labels)
          ? (current.labels as Label[])
          : [];
        existing = labels.find((entry) => normalizeLabel(entry.name) === key);
        return existing ? { labels } : { labels: [...labels, label] };
      });
      if (!existing) await writeAppState("refresh-signal", { ts: Date.now() });
      return {
        status: "complete",
        backend: "local",
        label: existing
          ? { id: existing.id, name: existing.name, type: "user" }
          : label,
        accounts: [],
      };
    }

    const requested = accountEmails?.map((email) => email.toLowerCase());
    const { clients, errors } = await getClientsWithErrors(
      ownerEmail,
      requested?.length ? requested : undefined,
    );
    const reached = new Set(
      [...clients, ...errors].map(({ email }) => email.toLowerCase()),
    );
    const results: CreateLabelAccountResult[] = [
      ...errors.map(({ email, error }) => ({
        accountEmail: email,
        status: "failed" as const,
        error,
      })),
      ...(requested ?? [])
        .filter((email) => !reached.has(email))
        .map((accountEmail) => ({
          accountEmail,
          status: "failed" as const,
          error: `Account ${accountEmail} is not connected for this user`,
        })),
    ];

    let labelName = name;
    for (const { email, accessToken } of clients) {
      try {
        const existing = ((await gmailListLabels(accessToken)).labels ??
          []) as {
          id?: string;
          name?: string;
          type?: string;
        }[];
        const match = existing.find(
          (entry) => entry.name && normalizeLabel(entry.name) === key,
        );
        if (match?.id && match.name) {
          labelName = match.name;
          await addCachedGmailLabel(ownerEmail, email, {
            id: match.id,
            name: match.name,
            type: match.type ?? "user",
            messagesTotal: 0,
            messagesUnread: 0,
            threadsTotal: 0,
            threadsUnread: 0,
          });
          results.push({ accountEmail: email, status: "existing" });
          continue;
        }
        const created = (await gmailCreateLabel(accessToken, name)) as {
          id: string;
          name: string;
          type?: string;
        };
        await addCachedGmailLabel(ownerEmail, email, {
          id: created.id,
          name: created.name,
          type: created.type ?? "user",
          messagesTotal: 0,
          messagesUnread: 0,
          threadsTotal: 0,
          threadsUnread: 0,
        });
        results.push({ accountEmail: email, status: "created" });
      } catch (err) {
        results.push({
          accountEmail: email,
          status: "failed",
          error: err instanceof Error ? err.message : "Gmail API error",
        });
      }
    }

    const failed = results.filter((result) => result.status === "failed");
    if (results.length === 0) {
      fail("No connected Gmail account to create the label in", {
        errorCode: "create_label_failed",
        statusCode: 400,
      });
    }
    if (failed.length === results.length) {
      fail(`Could not create label "${name}"`, {
        errorCode: "create_label_failed",
        statusCode: 502,
        details: { accounts: results },
      });
    }
    if (results.some((result) => result.status === "created"))
      await writeAppState("refresh-signal", { ts: Date.now() });
    return {
      status: failed.length > 0 ? "partial" : "complete",
      backend: "gmail",
      label: { ...label, id: labelViewId(labelName), name: labelName },
      accounts: results,
    };
  },
});
