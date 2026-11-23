import { z } from "zod";

export const dataConnectionTestSchema = z
  .object({
    connectionId: z.string().min(1).max(200).optional(),
    projectId: z.string().trim().min(1).max(200),
    serviceAccount: z.string().min(1).max(65536).optional(),
    driveAccess: z.boolean().optional(),
    datasetNames: z.string().max(4000).optional(),
    hasDbtMetadata: z.boolean().optional(),
    dbtVersion: z.enum(["current", "legacy"]).optional(),
    dbtAccountId: z.string().trim().max(200).optional(),
    dbtProjectId: z.string().trim().max(200).optional(),
    dbtEnvironmentId: z.string().trim().max(200).optional(),
    dbtCloudHostname: z.string().trim().max(253).optional(),
    dbtToken: z.string().max(16384).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.serviceAccount || value.connectionId), {
    message: "Provide a service account key or a saved connection ID.",
  });

export const dataConnectionTestStatus = {
  credentialRejected: 422,
  accessDenied: 424,
  projectMissing: 404,
  rateLimited: 429,
  timedOut: 504,
  unavailable: 502,
} as const;
