import {
  type MailosaurMessage,
  verificationLinkFor,
} from "../signup/lib/mailosaur.ts";

export const LABS_QA_ORIGIN = "https://labs.agent-native.com";

export function labsQaEmailLink(
  message: MailosaurMessage,
  app: string,
  email: string,
  requestedAt: number,
): URL {
  if (
    !(Date.parse(message.received ?? "") >= requestedAt) ||
    !message.to?.some((recipient) => recipient.email?.toLowerCase() === email)
  ) {
    throw new Error("Unexpected QA email-link message");
  }
  const landing = "/_agent-native/auth/email-link/landing";
  const link = new URL(verificationLinkFor(message, LABS_QA_ORIGIN));
  if (
    !/^[a-z0-9-]+$/.test(app) ||
    ![landing, "/" + app + landing].includes(link.pathname) ||
    link.origin !== LABS_QA_ORIGIN ||
    link.username ||
    link.password ||
    link.searchParams.get("kind") !== "magic-link" ||
    !link.searchParams.get("token")
  ) {
    throw new Error("Unexpected QA email-link destination");
  }
  for (const key of ["callbackURL", "newUserCallbackURL", "errorCallbackURL"]) {
    for (const value of link.searchParams.getAll(key)) {
      const callback = new URL(value, LABS_QA_ORIGIN);
      if (
        callback.origin !== LABS_QA_ORIGIN ||
        callback.username ||
        callback.password
      ) {
        throw new Error("Unexpected QA email-link callback");
      }
    }
  }
  return link;
}
