/**
 * Create a new meeting — from a calendar event or ad-hoc.
 *
 * Usage:
 *   pnpm action create-meeting --title="Weekly standup"
 *   pnpm action create-meeting --title="1:1 with Alice" --startTime="2026-04-28T10:00:00Z"
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  nanoid,
  requireActiveOrganizationId,
} from "../server/lib/meetings.js";

export default defineAction({
  description:
    "Create a new meeting (from a calendar event or ad-hoc). Returns the new meeting id.",
  schema: z.object({
    id: z
      .string()
      .optional()
      .describe("Pre-generated meeting ID (for optimistic UI)"),
    title: z
      .string()
      .optional()
      .describe("Meeting title (defaults to 'Untitled meeting')"),
    startTime: z
      .string()
      .optional()
      .describe("ISO date — when the meeting starts"),
    endTime: z.string().optional().describe("ISO date — when the meeting ends"),
    calendarEventId: z
      .string()
      .optional()
      .describe("Calendar event ID (if synced from a calendar)"),
    calendarProvider: z
      .enum(["google", "microsoft"])
      .optional()
      .describe("Calendar provider"),
    folderId: z.string().nullish().describe("Optional folder ID"),
    organizationId: z
      .string()
      .optional()
      .describe("Organization (defaults to the caller's active org)"),
    attendees: z
      .array(
        z.object({
          name: z.string(),
          email: z.string().optional(),
          role: z
            .enum(["organizer", "required", "optional"])
            .optional()
            .default("required"),
        }),
      )
      .optional()
      .describe("Attendees to add to the meeting"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const id = args.id || nanoid();
    const now = new Date().toISOString();

    const organizationId =
      args.organizationId || (await requireActiveOrganizationId());

    await db.insert(schema.meetings).values({
      id,
      organizationId,
      title: args.title?.trim() || "Untitled meeting",
      startTime: args.startTime ?? null,
      endTime: args.endTime ?? null,
      calendarEventId: args.calendarEventId ?? null,
      calendarProvider: args.calendarProvider ?? null,
      folderId: args.folderId ?? null,
      status: "scheduled",
      ownerEmail,
      createdAt: now,
      updatedAt: now,
    });

    // Create initial notes row
    await db.insert(schema.meetingNotes).values({
      id: nanoid(),
      meetingId: id,
      rawContent: "{}",
      createdAt: now,
      updatedAt: now,
    });

    // Add attendees if provided
    if (args.attendees?.length) {
      const seenPeople = new Set<string>();
      for (const attendee of args.attendees) {
        const email = attendee.email?.trim().toLowerCase() || null;
        const personId = email
          ? await upsertPersonForAttendee({
              organizationId,
              name: attendee.name,
              email,
              seenAt: args.startTime ?? now,
              seenPeople,
            })
          : null;

        await db.insert(schema.meetingAttendees).values({
          id: nanoid(),
          meetingId: id,
          personId,
          name: attendee.name,
          email,
          role: attendee.role ?? "required",
        });
      }
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Created meeting "${args.title ?? "Untitled meeting"}" (${id})`,
    );

    return {
      id,
      organizationId,
      status: "scheduled" as const,
    };
  },
});

async function upsertPersonForAttendee({
  organizationId,
  name,
  email,
  seenAt,
  seenPeople,
}: {
  organizationId: string;
  name: string;
  email: string;
  seenAt: string;
  seenPeople: Set<string>;
}): Promise<string> {
  const db = getDb();
  const domain = email.split("@")[1]?.trim().toLowerCase() || null;
  const companyId = domain
    ? await upsertCompanyForDomain(organizationId, domain)
    : null;
  const now = new Date().toISOString();

  const [existing] = await db
    .select()
    .from(schema.people)
    .where(
      and(
        eq(schema.people.organizationId, organizationId),
        eq(schema.people.email, email),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(schema.people)
      .set({
        name: existing.name || name,
        companyId: existing.companyId ?? companyId,
        lastSeenAt: seenAt,
        meetingCount: seenPeople.has(email)
          ? existing.meetingCount
          : existing.meetingCount + 1,
        updatedAt: now,
      })
      .where(eq(schema.people.id, existing.id));
    seenPeople.add(email);
    return existing.id;
  }

  const id = nanoid();
  await db.insert(schema.people).values({
    id,
    organizationId,
    name,
    email,
    companyId,
    title: null,
    avatarUrl: null,
    lastSeenAt: seenAt,
    meetingCount: seenPeople.has(email) ? 0 : 1,
    createdAt: now,
    updatedAt: now,
  });
  seenPeople.add(email);
  return id;
}

async function upsertCompanyForDomain(
  organizationId: string,
  domain: string,
): Promise<string> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.companies)
    .where(
      and(
        eq(schema.companies.organizationId, organizationId),
        eq(schema.companies.domain, domain),
      ),
    )
    .limit(1);

  if (existing) return existing.id;

  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(schema.companies).values({
    id,
    organizationId,
    name: companyNameFromDomain(domain),
    domain,
    logoUrl: null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

function companyNameFromDomain(domain: string): string {
  const base = domain.split(".")[0] || domain;
  return base
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
