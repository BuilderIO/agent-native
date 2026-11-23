import { z } from "zod";

export const workspaceSshKeySchema = z
  .object({
    id: z.string().min(1),
    sshPublicKey: z.string().min(1),
  })
  .strict();

export type WorkspaceSshKey = z.infer<typeof workspaceSshKeySchema>;
