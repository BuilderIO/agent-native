import type { EmailAddress, EmailMessage } from "./types";

function normalizeEmail(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function recipients(message: EmailMessage): EmailAddress[] {
  return [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])];
}

function participants(message: EmailMessage): EmailAddress[] {
  return [message.from, ...recipients(message)];
}

function isConnectedAddress(
  address: EmailAddress | undefined,
  connectedEmails: ReadonlySet<string>,
): boolean {
  const email = normalizeEmail(address?.email);
  return !!email && connectedEmails.has(email);
}

/**
 * A note-to-self thread starts as a message from the user to one of their own
 * connected accounts, and every known participant in the thread is one of the
 * user's connected accounts.
 */
export function isSelfAddressedThread(
  messages: readonly EmailMessage[],
  connectedEmails: ReadonlySet<string>,
): boolean {
  const normalizedConnectedEmails = new Set(
    [...connectedEmails].map(normalizeEmail).filter(Boolean),
  );
  if (normalizedConnectedEmails.size === 0 || messages.length === 0) {
    return false;
  }

  const sorted = [...messages].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const original = sorted[0];
  if (!isConnectedAddress(original.from, normalizedConnectedEmails)) {
    return false;
  }
  if (
    !recipients(original).some((addr) =>
      isConnectedAddress(addr, normalizedConnectedEmails),
    )
  ) {
    return false;
  }

  return sorted.every((message) =>
    participants(message).every((addr) =>
      isConnectedAddress(addr, normalizedConnectedEmails),
    ),
  );
}
