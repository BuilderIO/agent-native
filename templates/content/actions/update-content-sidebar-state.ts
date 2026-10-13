import { defineAction } from "@agent-native/core/action";
import { getUserSetting, mutateUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { defaultContentSidebarSections } from "../shared/content-personal-navigation.js";
import {
  CONTENT_SIDEBAR_STATE_SETTING_KEY,
  contentSidebarStateSettingKey,
  contentSidebarStateSchema,
  normalizeContentSidebarState,
} from "./_content-sidebar-state.js";

const sidebarSectionPatchSchema = z.object({
  visible: z.boolean().optional(),
  expanded: z.boolean().optional(),
});
const contentSidebarSectionsPatchSchema = z.object({
  order: contentSidebarStateSchema.shape.sections
    .unwrap()
    .shape.order.optional(),
  pinned: sidebarSectionPatchSchema.optional(),
  recent: sidebarSectionPatchSchema.optional(),
  files: sidebarSectionPatchSchema.optional(),
});

export default defineAction({
  description: "Persist the current user's Content sidebar expansion state.",
  schema: contentSidebarStateSchema
    .partial()
    .required({ version: true })
    .extend({
      spaceId: z.string().min(1).max(256).optional(),
      sectionsPatch: contentSidebarSectionsPatchSchema.optional(),
    }),
  agentTool: false,
  run: async ({ spaceId, sectionsPatch, ...state }, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    const scopedKey = contentSidebarStateSettingKey(spaceId);
    const legacy =
      scopedKey === CONTENT_SIDEBAR_STATE_SETTING_KEY
        ? null
        : await getUserSetting(
            ctx.userEmail,
            CONTENT_SIDEBAR_STATE_SETTING_KEY,
          );
    const saved = await mutateUserSetting(
      ctx.userEmail,
      scopedKey,
      (current) => {
        const normalized = normalizeContentSidebarState(
          current ?? legacy,
          spaceId,
        );
        const sections = state.sections ?? normalized?.sections;
        return normalizeContentSidebarState({
          ...normalized,
          ...state,
          ...(sectionsPatch
            ? {
                sections: {
                  ...(sections ?? defaultContentSidebarSections()),
                  ...(sectionsPatch.order
                    ? { order: sectionsPatch.order }
                    : {}),
                  pinned: {
                    ...(sections ?? defaultContentSidebarSections()).pinned,
                    ...sectionsPatch.pinned,
                  },
                  recent: {
                    ...(sections ?? defaultContentSidebarSections()).recent,
                    ...sectionsPatch.recent,
                  },
                  files: {
                    ...(sections ?? defaultContentSidebarSections()).files,
                    ...sectionsPatch.files,
                  },
                },
              }
            : {}),
        })!;
      },
    );
    return { state: normalizeContentSidebarState(saved, spaceId) };
  },
});
