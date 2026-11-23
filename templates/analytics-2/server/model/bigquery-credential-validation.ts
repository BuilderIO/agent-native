import {
  ActionContractError,
  isActionContractError,
} from "@agent-native/core/action";
import { createProviderApiRuntime } from "@agent-native/core/provider-api";
import { getRequestContext } from "@agent-native/core/server";
import type { WorkspaceCredentialServiceOptions } from "@agent-native/core/workspace-connections";
import { z } from "zod";

const providerErrorBody = z.object({
  error: z.object({
    message: z.string().optional(),
    errors: z.array(z.object({ message: z.string().optional() })).default([]),
  }),
});

function extractProviderRejection(response?: {
  status?: number;
  ok?: boolean;
  truncated?: boolean;
  json?: unknown;
}): { status: number; providerMessage?: string } | undefined {
  if (!response || response.ok || typeof response.status !== "number")
    return undefined;
  const parsed = providerErrorBody.safeParse(response.json);
  const providerMessage =
    parsed.data?.error.message?.trim() ||
    parsed.data?.error.errors[0]?.message?.trim() ||
    undefined;
  return {
    status: response.status,
    ...(providerMessage ? { providerMessage } : {}),
  };
}

type WorkspaceCredentialValidationInput = Parameters<
  WorkspaceCredentialServiceOptions["validateCredentials"]
>[0];

const PROJECT = "BIGQUERY_PROJECT_ID";
const CREDENTIAL = "GOOGLE_APPLICATION_CREDENTIALS_JSON";
const CREDENTIAL_PROVIDER = new Map([
  [PROJECT, "bigquery"],
  [CREDENTIAL, "gcloud"],
]);
const MESSAGE = "The warehouse connection could not be validated.";

/** Server-only prepublication check for the native workspace credential service.
 * Checks authentication and one dataset-discovery page, without creating jobs or
 * persisting credentials. Success does not certify table access or SQL rights.
 */
export function createBigQueryCredentialValidator(options: { appId: string }) {
  const appId = options.appId.trim();
  if (!appId) throw new Error(MESSAGE);
  return async (input: WorkspaceCredentialValidationInput): Promise<void> => {
    try {
      input.signal.throwIfAborted();
      const before = getRequestContext();
      const email = before?.userEmail?.trim().toLowerCase();
      const orgId = before?.orgId?.trim();
      const authUserId = before?.authUserId;
      if (!email || !orgId || input.provider !== "bigquery")
        throw new Error(MESSAGE);
      const values = new Map(
        input.secretValues.map(({ key, secret }) => [key, secret]),
      );
      const project = values.get(PROJECT);
      const credential = values.get(CREDENTIAL);
      if (
        input.secretValues.length !== 2 ||
        values.size !== 2 ||
        !project?.trim() ||
        !credential?.trim()
      )
        throw new Error(MESSAGE);
      const runtime = createProviderApiRuntime({
        appId,
        providerIds: ["bigquery"],
        unsafeRequestPolicy: "single-attempt",
        maxResponseBytes: 65536,
        getCredentialContext: () => ({
          userEmail: email,
          orgId,
          credentialScope: "org",
        }),
        resolveCredential: async (lookup) => {
          input.signal.throwIfAborted();
          const current = getRequestContext();
          const expectedProvider = CREDENTIAL_PROVIDER.get(lookup.key);
          if (
            current?.userEmail?.trim().toLowerCase() !== email ||
            current?.orgId?.trim() !== orgId ||
            current?.authUserId !== authUserId ||
            !expectedProvider ||
            lookup.provider !== expectedProvider ||
            lookup.connectionId
          )
            throw new Error(MESSAGE);
          return {
            key: lookup.key,
            value: values.get(lookup.key)!,
            provider: lookup.provider,
            source: "connection_validation",
            scope: "org",
            scopeId: orgId,
          };
        },
      });
      // A dry run that references no table: `SELECT 1 ... WHERE FALSE` asks only
      // for permission to create a job, which is exactly what a service account
      // scoped to a few datasets still has. It creates no job (dryRun) and reads
      // no dataset metadata, so it proves the credential without the project-wide
      // listing a least-privilege key is denied (sprint-analytics-2#812).
      const dryRunResult = async (): Promise<{
        ok: boolean;
        rejection?: { status: number; providerMessage?: string };
      }> => {
        try {
          const result = (await runtime.executeRequest({
            provider: "bigquery",
            method: "POST",
            path: `/projects/${encodeURIComponent(project.trim())}/jobs`,
            query: { alt: "json" },
            body: {
              configuration: {
                dryRun: true,
                query: {
                  query: "SELECT 1 AS ok WHERE FALSE",
                  useLegacySql: false,
                },
              },
            },
            signal: input.signal,
            timeoutMs: 10000,
            maxBytes: 65536,
          })) as {
            response?: {
              status?: number;
              ok?: boolean;
              truncated?: boolean;
              json?: unknown;
            };
          };
          input.signal.throwIfAborted();
          const run = result?.response;
          if (run?.status !== 200 || run.ok !== true || run.truncated) {
            const rejection = extractProviderRejection(run);
            return {
              ok: false,
              ...(rejection ? { rejection } : {}),
            };
          }
          const payload = run.json;
          if (!payload || typeof payload !== "object" || Array.isArray(payload))
            return { ok: false };
          if ("error" in payload) return { ok: false };
          const typed = payload as Record<string, unknown>;
          const configuration = typed.configuration as
            | Record<string, unknown>
            | undefined;
          return {
            ok: typed.kind === "bigquery#job" || configuration?.dryRun === true,
          };
        } catch {
          return { ok: false };
        }
      };
      const result = (await runtime.executeRequest({
        provider: "bigquery",
        method: "GET",
        path: `/projects/${encodeURIComponent(project.trim())}/datasets`,
        query: { maxResults: 1 },
        signal: input.signal,
        timeoutMs: 10000,
        maxBytes: 65536,
      })) as {
        response?: {
          status?: number;
          ok?: boolean;
          truncated?: boolean;
          json?: unknown;
        };
      };
      input.signal.throwIfAborted();
      const response = result?.response;
      const body = response?.json;
      const listed =
        response?.status === 200 &&
        response.ok === true &&
        !response.truncated &&
        !!body &&
        typeof body === "object" &&
        !Array.isArray(body) &&
        (body as Record<string, unknown>).kind === "bigquery#datasetList" &&
        !("error" in body) &&
        (!("datasets" in body) ||
          Array.isArray((body as Record<string, unknown>).datasets));
      // A key scoped to a few datasets is denied the project-wide listing but can
      // still run jobs inside them, so a failed listing is not a failed key: the
      // dry run decides, and only a key that cannot create a job is refused.
      if (!listed) {
        const dryRun = await dryRunResult();
        if (!dryRun.ok) {
          const rejection =
            dryRun.rejection ?? extractProviderRejection(response);
          if (rejection)
            throw new ActionContractError(
              "Error connecting to data source. Please check your connection details and user permissions, then try again, or save as draft.",
              {
                errorCode: "data_connection_rejected",
                statusCode:
                  rejection.status === 401 || rejection.status === 403
                    ? 403
                    : 502,
                details: {
                  operation: "datasets",
                  providerStatus: rejection.status,
                  ...(rejection.providerMessage
                    ? { providerMessage: rejection.providerMessage }
                    : {}),
                },
              },
            );
          throw new Error(MESSAGE);
        }
      }
      const after = getRequestContext();
      if (
        after?.userEmail?.trim().toLowerCase() !== email ||
        after?.orgId?.trim() !== orgId ||
        after?.authUserId !== authUserId
      )
        throw new Error(MESSAGE);
    } catch (error) {
      if (isActionContractError(error)) throw error;
      // Provider bodies and submitted secrets never become an action error.
      throw new Error(MESSAGE);
    }
  };
}
