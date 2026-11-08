import {
  emailQuote,
  emailStrong,
  renderEmail,
} from "@agent-native/core/server";

import type { DeckAccessRequestRole } from "../../shared/deck-access.js";

export const SLIDES_DECK_ACCESS_REQUEST_EMAIL_ID = "slides.deck-access-request";

function cleanSubjectPart(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function renderDeckAccessRequestEmail(input: {
  requesterName: string;
  requesterEmail: string;
  deckTitle: string;
  url: string;
  allowAccessUrl: string;
  note?: string;
  requestedRole: DeckAccessRequestRole;
}) {
  const subject = `${input.requestedRole === "editor" ? "Edit access" : "Access"} request for "${cleanSubjectPart(input.deckTitle)}"`;
  return {
    subject,
    ...renderEmail({
      brandName: "Slides",
      preheader: subject,
      heading: "Access requested",
      paragraphs: [
        `${emailStrong(input.requesterName)} (${emailStrong(input.requesterEmail)}) requested ${input.requestedRole === "editor" ? "edit" : "view"} access to ${emailStrong(input.deckTitle)}.`,
        ...(input.note ? [emailQuote(input.note)] : []),
        "Select Allow access to choose their role and add them to this deck's sharing list. You can also open the deck to review sharing first.",
      ],
      cta: { label: "Allow access", url: input.allowAccessUrl },
      secondaryCta: { label: "Open deck", url: input.url },
      closingParagraphs: [
        "This approval link expires in 7 days and requires you to be signed in as a deck owner or admin.",
      ],
      footer:
        "You received this because you own this deck. If you do not recognize the requester, you can ignore this email.",
    }),
  };
}

export const SLIDES_DECK_ACCESS_GRANTED_EMAIL_ID = "slides.deck-access-granted";

export function renderDeckAccessGrantedEmail(input: {
  approverName: string;
  deckTitle: string;
  url: string;
  grantedRole: DeckAccessRequestRole;
}) {
  const subject = `You now have access to "${cleanSubjectPart(input.deckTitle)}"`;
  return {
    subject,
    ...renderEmail({
      brandName: "Slides",
      preheader: subject,
      heading: "Access granted",
      paragraphs: [
        `${emailStrong(input.approverName)} approved your request. You can now ${input.grantedRole === "editor" ? "edit" : "view"} ${emailStrong(input.deckTitle)}.`,
      ],
      cta: { label: "Open deck", url: input.url },
      footer:
        "You received this because you requested access to this deck. Sign in with this email address to open it.",
    }),
  };
}
