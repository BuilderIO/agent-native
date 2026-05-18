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

export function buildBookingEventTitle({
  explicitTitle,
  hostEmail,
  attendeeName,
}: {
  explicitTitle?: unknown;
  hostEmail: string;
  attendeeName: unknown;
}) {
  const explicit = stripCrlf(explicitTitle);
  if (explicit) return explicit;

  const hostName = firstNameForTitle(displayNameFromEmail(hostEmail));
  const guestName = firstNameForTitle(stripCrlf(attendeeName)) || "Guest";
  return `${hostName} + ${guestName}`;
}

export function buildBookingEventAttendees({
  attendeeEmail,
  attendeeName,
}: {
  attendeeEmail: string;
  attendeeName: string;
}) {
  return [
    {
      email: attendeeEmail,
      displayName: attendeeName,
    },
  ];
}
