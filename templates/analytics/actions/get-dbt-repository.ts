import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { getOrgSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  DBT_REPOSITORY_SETTING_KEY,
  dbtRepositorySettingSchema,
} from "../server/lib/index-build-github.js";

export default defineAction({
  description:
    "Read the GitHub repository configured as the organization's dbt project, as owner and repo. Returns null when no repository is set. Read-only.",
  schema: z.object({}),
  readOnly: true,
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const email = getRequestUserEmail() || ctx?.userEmail;
    if (!email) {
      fail("Sign in to read the dbt repository.", {
        errorCode: "authentication_required",
        statusCode: 401,
      });
    }
    const orgId = getRequestOrgId() || ctx?.orgId;
    if (!orgId) {
      fail("An active organization is required to read the dbt repository.", {
        errorCode: "organization_required",
        statusCode: 403,
      });
    }
    const value = await getOrgSetting(orgId, DBT_REPOSITORY_SETTING_KEY);
    if (!value) return null;
    const parsed = dbtRepositorySettingSchema.safeParse(value);
    if (!parsed.success) {
      fail("The organization's dbt repository setting is invalid.", {
        errorCode: "dbt_repository_invalid",
        statusCode: 500,
      });
    }
    return parsed.data;
  },
});
