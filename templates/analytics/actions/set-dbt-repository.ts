import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { putOrgSetting } from "@agent-native/core/settings";

import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections.js";
import {
  DBT_REPOSITORY_SETTING_KEY,
  dbtRepositorySettingSchema,
} from "../server/lib/index-build-github.js";

export default defineAction({
  description:
    "Set the GitHub repository that holds the organization's dbt project. The source index is built from it. Requires an organization owner or admin. The owner and repo are validated as GitHub names. Saving replaces the previous repository but does not rebuild the index; run build-data-index to index it.",
  schema: dbtRepositorySettingSchema,
  run: async ({ owner, repo }, ctx) => {
    const admin = await requireAnalyticsAdminContext({
      userEmail: getRequestUserEmail() || ctx?.userEmail,
      orgId: getRequestOrgId() || ctx?.orgId || null,
    });
    const repository = { owner, repo };
    await putOrgSetting(admin.orgId, DBT_REPOSITORY_SETTING_KEY, repository);
    return repository;
  },
});
