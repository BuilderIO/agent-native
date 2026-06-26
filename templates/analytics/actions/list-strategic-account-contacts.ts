import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
  buildDeepLink,
} from "@agent-native/core/server";
import { z } from "zod";

import { listStrategicAccountContacts } from "../server/lib/strategic-account-contacts-store";

export default defineAction({
  description:
    "List the curated Strategic Account Coverage contacts for the current org (champions, enablers, exec sponsors). This is the source of truth for the Strategic Account Coverage dashboard — the contact details live only in the database, never in source. Returns each contact's company, role, name, title, email, confidence, and rationale.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  link: () => ({
    url: buildDeepLink({
      app: "analytics",
      view: "adhoc",
      params: { dashboardId: "strategic-account-coverage" },
    }),
    label: "Open Strategic Account Coverage",
    view: "adhoc",
  }),
  run: async () => {
    const orgId = getRequestOrgId() || null;
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const contacts = await listStrategicAccountContacts({ email, orgId });
    return { count: contacts.length, contacts };
  },
});
