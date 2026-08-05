import { z } from "zod";

export const appointmentBlockSchema = z.object({
  id: z.string(),
  title: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  blockStart: z.string(),
  blockEnd: z.string(),
});

export const conflictSchema = z.object({
  title: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  attendees: z.array(z.string()),
  externalAttendees: z.array(z.string()),
  appointmentIds: z.array(z.string()),
});

export const conflictCheckSchema = z.object({
  status: z.enum([
    "not_checked",
    "clear",
    "internal_only",
    "external_conflicts",
  ]),
  checkedAt: z.string(),
  conflicts: z.array(conflictSchema),
});

export const appointmentPlanSchema = z.object({
  planId: z.string(),
  sourceLabel: z.string(),
  bufferMinutes: z.number(),
  timezone: z.string(),
  appointments: z.array(appointmentBlockSchema),
  conflictCheck: conflictCheckSchema,
  status: z.enum(["draft", "review", "approved"]),
  approvedAt: z.string().nullable(),
});

export type AppointmentPlan = z.infer<typeof appointmentPlanSchema>;
export type ConflictCheck = z.infer<typeof conflictCheckSchema>;

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const DATE_RANGE_PATTERN =
  /(?:mon|tue|wed|thu|fri|sat|sun)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4}).*?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;

function parseClock(
  hour: string,
  minute: string | undefined,
  meridiem: string,
) {
  let parsedHour = Number(hour);
  if (meridiem.toLowerCase() === "pm" && parsedHour !== 12) parsedHour += 12;
  if (meridiem.toLowerCase() === "am" && parsedHour === 12) parsedHour = 0;
  return { hour: parsedHour, minute: Number(minute ?? "0") };
}

function formatIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  offset: string,
) {
  const monthText = String(month + 1).padStart(2, "0");
  const dayText = String(day).padStart(2, "0");
  const hourText = String(hour).padStart(2, "0");
  const minuteText = String(minute).padStart(2, "0");
  return new Date(
    `${year}-${monthText}-${dayText}T${hourText}:${minuteText}:00${offset}`,
  ).toISOString();
}

function offsetForText(line: string) {
  if (/\bPST\b/i.test(line)) return "-08:00";
  return "-07:00";
}

export function parseDateRange(line: string) {
  const match = line.match(DATE_RANGE_PATTERN);
  if (!match) return null;

  const month = MONTHS[match[1].slice(0, 3).toLowerCase()];
  if (month === undefined) return null;
  const year = Number(match[3]);
  const day = Number(match[2]);
  const start = parseClock(match[4], match[5], match[6]);
  const end = parseClock(match[7], match[8], match[9]);
  const offset = offsetForText(line);

  return {
    startTime: formatIso(year, month, day, start.hour, start.minute, offset),
    endTime: formatIso(year, month, day, end.hour, end.minute, offset),
  };
}

function addMinutes(iso: string, minutes: number) {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function titleForLine(line: string, fallback: string) {
  const normalize = (title: string) =>
    title.replace(/^(?:updated\s+)?invitation:\s*/i, "").trim();
  const pipeTitle = line.split("|")[0]?.trim();
  if (pipeTitle && !DATE_RANGE_PATTERN.test(pipeTitle)) {
    return normalize(pipeTitle);
  }
  const atTitle = line.split(/\s+@\s+/)[0]?.trim();
  return atTitle ? normalize(atTitle) : fallback;
}

export function parseAppointmentSource(
  sourceText: string,
  bufferMinutes: number,
) {
  const parsedAppointments = sourceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line, index) => {
      const range = parseDateRange(line);
      if (!range) return [];
      return [
        {
          id: `appointment-${index + 1}`,
          title: titleForLine(line, `Appointment ${index + 1}`),
          ...range,
          blockStart: addMinutes(range.startTime, -bufferMinutes),
          blockEnd: addMinutes(range.endTime, bufferMinutes),
        },
      ];
    });

  const appointments = Array.from(
    new Map(
      parsedAppointments.map((appointment) => [
        `${appointment.startTime}|${appointment.endTime}`,
        appointment,
      ]),
    ).values(),
  ).map((appointment, index) => ({
    ...appointment,
    id: `appointment-${index + 1}`,
  }));

  if (appointments.length === 0) {
    throw new Error(
      "No appointment date ranges found. Use lines like: Appointment | Wed Oct 7, 2026 9am - 9:30am (PDT).",
    );
  }

  return appointments;
}

export function parseCalendarSnapshot(calendarText: string) {
  return calendarText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const range = parseDateRange(line);
      if (!range) return [];
      const pieces = line.split("|").map((piece) => piece.trim());
      const attendeeText = pieces.find((piece) => /attendees?:/i.test(piece));
      const attendees = (attendeeText?.replace(/^attendees?:\s*/i, "") ?? "")
        .split(/[,\s]+/)
        .map((email) => email.trim())
        .filter((email) => email.includes("@"));
      const title = pieces[0] || "Calendar event";
      return [{ title, ...range, attendees }];
    });
}

export function overlaps(
  leftStart: string,
  leftEnd: string,
  rightStart: string,
  rightEnd: string,
) {
  return (
    new Date(leftStart).getTime() < new Date(rightEnd).getTime() &&
    new Date(rightStart).getTime() < new Date(leftEnd).getTime()
  );
}

export function formatPlanDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
    timeZoneName: "short",
  }).format(new Date(iso));
}
