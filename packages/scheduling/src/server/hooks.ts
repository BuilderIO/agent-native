import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { addMinutes } from "../core/time.js";
import type { Booking, Workflow, WorkflowStep } from "../shared/index.js";
import { getSchedulingContext } from "./context.js";

interface BookingPrincipal {
  ownerEmail: string;
  orgId: string | null;
  teamId: string | null;
}

export async function onBookingCreated(booking: Booking): Promise<void> {
  const principal = getBookingPrincipal(booking);
  await materializeReminders(booking, "new-booking");
  await materializeRemindersBefore(booking);
  await enqueueWebhooks(booking, "BOOKING_CREATED", principal);
}

export async function onBookingRescheduled(
  original: Booking,
  next: Booking,
): Promise<void> {
  const principal = getBookingPrincipal(original);
  await materializeReminders(next, "reschedule");
  await enqueueWebhooks(next, "BOOKING_RESCHEDULED", principal);
}

export async function onBookingCancelled(booking: Booking): Promise<void> {
  const principal = getBookingPrincipal(booking);
  await materializeReminders(booking, "cancellation");
  await enqueueWebhooks(booking, "BOOKING_CANCELLED", principal);
  const { getDb, schema } = getSchedulingContext();
  await getDb()
    .update(schema.scheduledReminders)
    .set({ sent: true, sentAt: new Date().toISOString() })
    .where(
      and(
        eq(schema.scheduledReminders.bookingId, booking.id),
        eq(schema.scheduledReminders.sent, false),
      ),
    );
}

export async function onBookingNoShow(booking: Booking): Promise<void> {
  const principal = getBookingPrincipal(booking);
  await materializeReminders(booking, "no-show");
  await enqueueWebhooks(booking, "BOOKING_NO_SHOW", principal);
}

function getBookingPrincipal(booking: Booking): BookingPrincipal {
  return {
    ownerEmail: (booking.ownerEmail ?? booking.hostEmail).trim().toLowerCase(),
    orgId: booking.orgId ?? null,
    teamId: booking.teamId ?? null,
  };
}

async function materializeReminders(
  booking: Booking,
  trigger: "new-booking" | "reschedule" | "cancellation" | "no-show",
): Promise<void> {
  const workflows = await activeWorkflowsForEvent(booking, trigger);
  const now = new Date();
  for (const wf of workflows) {
    for (const step of wf.steps) {
      const scheduledFor =
        trigger === "new-booking" && step.offsetMinutes > 0
          ? addMinutes(now, step.offsetMinutes)
          : now;
      await writeReminder(booking, step, scheduledFor);
    }
  }
}

async function materializeRemindersBefore(booking: Booking): Promise<void> {
  const workflows = await activeWorkflowsForEvent(booking, "before-event");
  const start = new Date(booking.startTime);
  for (const wf of workflows) {
    for (const step of wf.steps) {
      const scheduledFor = addMinutes(start, -Math.abs(step.offsetMinutes));
      if (scheduledFor <= new Date()) continue;
      await writeReminder(booking, step, scheduledFor);
    }
  }
  const afterWorkflows = await activeWorkflowsForEvent(booking, "after-event");
  const end = new Date(booking.endTime);
  for (const wf of afterWorkflows) {
    for (const step of wf.steps) {
      const scheduledFor = addMinutes(end, Math.abs(step.offsetMinutes));
      await writeReminder(booking, step, scheduledFor);
    }
  }
}

async function writeReminder(
  booking: Booking,
  step: WorkflowStep,
  scheduledFor: Date,
): Promise<void> {
  const { getDb, schema } = getSchedulingContext();
  await getDb()
    .insert(schema.scheduledReminders)
    .values({
      id: nanoid(),
      bookingId: booking.id,
      workflowStepId: step.id,
      method: methodForAction(step.action),
      scheduledFor: scheduledFor.toISOString(),
      sent: false,
      failed: false,
      attempts: 0,
      createdAt: new Date().toISOString(),
    });
}

function methodForAction(
  action: WorkflowStep["action"],
): "email" | "sms" | "webhook" {
  if (action.startsWith("sms-")) return "sms";
  if (action === "webhook") return "webhook";
  return "email";
}

async function activeWorkflowsForEvent(
  booking: Booking,
  trigger: string,
): Promise<Workflow[]> {
  const { getDb, schema } = getSchedulingContext();
  const db = getDb();
  const unteamedAccessScope = and(
    isNull(schema.workflows.teamId),
    accessFilter(schema.workflows, schema.workflowShares, {
      userEmail: booking.ownerEmail ?? booking.hostEmail,
      orgId: booking.orgId ?? undefined,
    }),
  );
  const accessScope = booking.teamId
    ? or(eq(schema.workflows.teamId, booking.teamId), unteamedAccessScope)
    : unteamedAccessScope;
  const wfRows = await db
    .select()
    .from(schema.workflows)
    .where(
      and(
        eq(schema.workflows.trigger, trigger as any),
        eq(schema.workflows.disabled, false),
        like(
          schema.workflows.activeOnEventTypeIds,
          `%"${booking.eventTypeId}"%`,
        ),
        accessScope,
      ),
    );
  const active = wfRows.filter((w: any) => {
    const ids = safeJson<string[]>(w.activeOnEventTypeIds) ?? [];
    return ids.includes(booking.eventTypeId);
  });
  if (active.length === 0) return [];
  const stepRows = await db
    .select()
    .from(schema.workflowSteps)
    .where(
      inArray(
        schema.workflowSteps.workflowId,
        active.map((w: any) => w.id),
      ),
    );
  return active.map((w: any) => hydrateWorkflow(w, stepRows));
}

async function enqueueWebhooks(
  booking: Booking,
  event: string,
  principal: BookingPrincipal,
): Promise<void> {
  const { getDb, schema } = getSchedulingContext();
  const db = getDb();
  const teamScope = principal.teamId
    ? or(
        eq(schema.webhooks.teamId, principal.teamId),
        isNull(schema.webhooks.teamId),
      )
    : isNull(schema.webhooks.teamId);
  const webhookScopes = [
    and(
      sql`lower(${schema.webhooks.ownerEmail}) = ${principal.ownerEmail.trim().toLowerCase()}`,
      principal.orgId
        ? or(
            eq(schema.webhooks.orgId, principal.orgId),
            isNull(schema.webhooks.orgId),
          )
        : isNull(schema.webhooks.orgId),
      teamScope,
    )!,
  ];
  if (principal.orgId) {
    webhookScopes.push(
      and(
        eq(schema.webhooks.orgId, principal.orgId),
        eq(schema.webhooks.visibility, "org"),
        teamScope,
      )!,
    );
  }
  const webhooks = await db
    .select()
    .from(schema.webhooks)
    .where(
      and(
        eq(schema.webhooks.active, true),
        or(...webhookScopes),
        like(schema.webhooks.eventTriggers, `%"${event}"%`),
        or(
          isNull(schema.webhooks.eventTypeId),
          eq(schema.webhooks.eventTypeId, booking.eventTypeId),
        ),
      ),
    );
  const now = new Date().toISOString();
  const {
    cancelToken: _cancelToken,
    rescheduleToken: _rescheduleToken,
    ...webhookBooking
  } = booking;
  void _cancelToken;
  void _rescheduleToken;
  for (const wh of webhooks) {
    const triggers = safeJson<string[]>(wh.eventTriggers) ?? [];
    if (!triggers.includes(event)) continue;
    await db.insert(schema.webhookDeliveries).values({
      id: nanoid(),
      webhookId: wh.id,
      triggeredAt: now,
      payload: JSON.stringify({ event, booking: webhookBooking }),
      success: false,
      attempts: 0,
    });
  }
}

function hydrateWorkflow(row: any, steps: any[]): Workflow {
  return {
    id: row.id,
    name: row.name,
    trigger: row.trigger,
    ownerEmail: row.ownerEmail ?? undefined,
    teamId: row.teamId ?? undefined,
    activeOnEventTypeIds: safeJson<string[]>(row.activeOnEventTypeIds) ?? [],
    disabled: Boolean(row.disabled),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    steps: steps
      .filter((s) => s.workflowId === row.id)
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        id: s.id,
        order: s.order,
        action: s.action,
        offsetMinutes: s.offsetMinutes,
        sendTo: s.sendTo ?? undefined,
        emailSubject: s.emailSubject ?? undefined,
        emailBody: s.emailBody ?? undefined,
        smsBody: s.smsBody ?? undefined,
        webhookUrl: s.webhookUrl ?? undefined,
        template: s.template ?? undefined,
      })),
  };
}

function safeJson<T = any>(s: string | null | undefined): T | undefined {
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
