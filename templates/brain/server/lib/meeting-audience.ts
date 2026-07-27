import { z } from "zod";

const attendeeEmailSchema = z.string().trim().email().max(320);

function emailCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(emailCandidates);
  if (!value || typeof value !== "object") return [value];

  const participant = value as Record<string, unknown>;
  return [
    participant.email,
    participant.email_address,
    participant.emailAddress,
  ];
}

function normalizeEmail(value: unknown): string | null {
  const parsed = attendeeEmailSchema.safeParse(value);
  return parsed.success ? parsed.data.toLowerCase() : null;
}

export function resolveMeetingMemberEmails(
  participantValues: unknown,
  sourceOwnerEmail: string,
): string[] {
  const memberEmails = Array.from(
    new Set(
      emailCandidates(participantValues)
        .map(normalizeEmail)
        .filter((email): email is string => Boolean(email)),
    ),
  ).sort();
  if (memberEmails.length) return memberEmails;

  const ownerEmail = normalizeEmail(sourceOwnerEmail);
  if (ownerEmail) return [ownerEmail];
  throw new Error("Meeting audience could not be resolved");
}
