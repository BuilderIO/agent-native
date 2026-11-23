import { fail } from "@agent-native/core/action";
import { z } from "zod";

const discoveryErrorSchema = z
  .object({
    path: z.array(z.union([z.string(), z.number()])).optional(),
    extensions: z.object({ code: z.string().optional() }).loose().optional(),
  })
  .loose();
const discoveryEnvelopeSchema = z.object({
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  errors: z.array(z.unknown()).optional(),
});

export type DiscoveryResult = {
  data: Record<string, unknown>;
  unreadableJob: "forbidden" | "no_data" | null;
};

function providerFailure(): never {
  return fail(
    "There was a problem fetching dbt metadata. Check the integration settings and try again.",
    { errorCode: "data_dbt_metadata_failed", statusCode: 502 },
  );
}

export function parseDiscoveryResponse(raw: unknown): DiscoveryResult {
  const envelope = discoveryEnvelopeSchema.safeParse(raw);
  if (!envelope.success) return providerFailure();
  const { data, errors } = envelope.data;
  if (!errors?.length) {
    if (!data) return providerFailure();
    return { data, unreadableJob: data.job === null ? "no_data" : null };
  }

  const parsed = errors.map((error) => discoveryErrorSchema.safeParse(error));
  if (parsed.some((entry) => !entry.success)) return providerFailure();
  const entries = parsed.flatMap((entry) =>
    entry.success ? [entry.data] : [],
  );
  const code = (entry: (typeof entries)[number]) => entry.extensions?.code;
  const root = (entry: (typeof entries)[number]) => entry.path?.[0];

  if (entries.every((entry) => code(entry) === "FORBIDDEN"))
    if (data && root(entries[0]!) === "job" && data.job === null)
      return { data, unreadableJob: "forbidden" };
    else
      return fail(
        "The dbt Service token could not access this project. Check its Metadata Only and Job Admin permissions.",
        { errorCode: "data_dbt_access_denied", statusCode: 403 },
      );
  if (
    data &&
    data.job === null &&
    entries.every(
      (entry) =>
        root(entry) === "job" &&
        (code(entry) === "FORBIDDEN" || code(entry) === "NO_DATA_AVAILABLE"),
    )
  )
    return { data, unreadableJob: "no_data" };
  if (
    entries.every(
      (entry) =>
        root(entry) === "environment" && code(entry) === "NO_DATA_AVAILABLE",
    )
  )
    return fail(
      "The dbt environment could not be read. Check the Environment ID and Service token.",
      { errorCode: "data_dbt_configuration_invalid", statusCode: 422 },
    );
  return providerFailure();
}
