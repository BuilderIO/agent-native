import { defineAction } from "@agent-native/core/action";
import {
  countUnread,
  listNotifications,
} from "@agent-native/core/notifications";
import { z } from "zod";

import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";

export default defineAction({
  description:
    "List the signed-in user's recent notifications and unread count.",
  schema: z.object({}).strict(),
  outputSchema: z.object({
    unreadCount: z.number(),
    items: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string().optional(),
        createdAtLabel: z.string(),
        read: z.boolean(),
        href: z.string().optional(),
      }),
    ),
  }),
  readOnly: true,
  persistInBrowser: false,
  http: { method: "GET" },
  run: async () => {
    const { ownerEmail } = await requireCurrentWorkspace();
    const [items, unreadCount] = await Promise.all([
      listNotifications(ownerEmail, { limit: 100 }),
      countUnread(ownerEmail),
    ]);
    return {
      unreadCount,
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        ...(item.body ? { description: item.body } : {}),
        createdAtLabel: item.createdAt,
        read: item.readAt !== null,
        ...(typeof item.metadata?.link === "string" &&
        /^\/(?:home|project|thread|context-studio)(?:\/|$|[?#])/.test(
          item.metadata.link,
        ) &&
        !item.metadata.link.includes("\\")
          ? { href: item.metadata.link }
          : {}),
      })),
    };
  },
});
