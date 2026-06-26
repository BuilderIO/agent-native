import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { updateStrategicAccountContact } from "../server/lib/strategic-account-contacts-store";

export default defineAction({
  description:
    "Edit one Strategic Account Coverage contact (role, name, title, email, confidence, rationale, company, or sort order). Requires editor access to the contact's org.",
  schema: z.object({
    id: z.string().min(1).describe("Contact row id."),
    companyName: z.string().optional(),
    role: z.enum(["champion", "enabler", "exec_sponsor"]).optional(),
    contactName: z.string().optional(),
    title: z.string().optional(),
    email: z.string().optional(),
    confidence: z.enum(["high", "medium", "low"]).optional(),
    rationale: z.string().optional(),
    sortOrder: z.number().optional(),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const orgId = getRequestOrgId() || null;
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const { id, ...patch } = args;
    const updated = await updateStrategicAccountContact(id, patch, {
      email,
      orgId,
    });
    if (!updated) {
      throw new Error(
        `coverage contact "${id}" not found (or you don't have access).`,
      );
    }
    return { ok: true, contact: updated };
  },
});
