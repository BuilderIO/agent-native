function stripCrlf(value: unknown): string {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function titleCaseToken(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function displayNameFromEmail(email: string): string {
  const localPart = email.split("@")[0]?.split("+")[0] ?? "";
  const parts = localPart
    .split(/[._-]+/)
    .map((part) => part.replace(/[^a-zA-Z0-9]/g, ""))
    .filter(Boolean);

  if (parts.length === 0) return email;
  return parts.map(titleCaseToken).join(" ");
}

function firstNameForTitle(value: string): string {
  return value.trim().split(/\s+/)[0] ?? value.trim();
}

function uniqueEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const email of emails) {
    const normalized = stripCrlf(email).toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function buildBookingEventTitle({
  explicitTitle,
  hostEmail,
  hostEmails,
  attendeeName,
}: {
  explicitTitle?: unknown;
  hostEmail: string;
  hostEmails?: string[];
  attendeeName: unknown;
}) {
  const explicit = stripCrlf(explicitTitle);
  if (explicit) return explicit;

  const hostNames = uniqueEmails([hostEmail, ...(hostEmails ?? [])]).map(
    (email) => firstNameForTitle(displayNameFromEmail(email)),
  );
  const guestName = firstNameForTitle(stripCrlf(attendeeName)) || "Guest";
  return `${hostNames.join(" + ")} + ${guestName}`;
}

export function buildBookingEventAttendees({
  attendeeEmail,
  attendeeName,
  hostEmails = [],
}: {
  attendeeEmail: string;
  attendeeName: string;
  hostEmails?: string[];
}) {
  const attendee = stripCrlf(attendeeEmail).toLowerCase();
  return [
    {
      email: attendee,
      displayName: attendeeName,
    },
    ...uniqueEmails(hostEmails)
      .filter((email) => email !== attendee)
      .map((email) => ({
        email,
        displayName: displayNameFromEmail(email),
      })),
  ];
}
