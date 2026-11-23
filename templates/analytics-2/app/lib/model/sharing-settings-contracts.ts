import { z } from "zod";

export const workspaceSharingSettingsSchema = z
  .object({
    allowPublicSharing: z.boolean(),
    allowWorkspaceSharing: z.boolean(),
    allowGuestCreation: z.boolean(),
  })
  .strict();

export type WorkspaceSharingSettings = z.infer<
  typeof workspaceSharingSettingsSchema
>;

export const workspaceSharingCapabilitiesSchema = z
  .object({
    publicSharingSupported: z.boolean(),
    guestSharingSupported: z.boolean(),
  })
  .strict();

export type WorkspaceSharingCapabilities = z.infer<
  typeof workspaceSharingCapabilitiesSchema
>;

export const workspaceSharingSettingsResponseSchema = z
  .object({
    settings: workspaceSharingSettingsSchema,
    capabilities: workspaceSharingCapabilitiesSchema,
    canEdit: z.boolean(),
  })
  .strict();

export type WorkspaceSharingSettingsResponse = z.infer<
  typeof workspaceSharingSettingsResponseSchema
>;

export const DEFAULT_WORKSPACE_SHARING_SETTINGS: WorkspaceSharingSettings = {
  allowPublicSharing: false,
  allowWorkspaceSharing: true,
  allowGuestCreation: false,
};
