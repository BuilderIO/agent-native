import { emailStrong, renderEmail } from "@agent-native/core/server";

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
}) {
  const subject = `Access request for "${cleanSubjectPart(input.deckTitle)}"`;
  return {
    subject,
    ...renderEmail({
      brandName: "Slides",
      preheader: subject,
      heading: "Access requested",
      paragraphs: [
        `${emailStrong(input.requesterName)} (${emailStrong(input.requesterEmail)}) requested access to ${emailStrong(input.deckTitle)}.`,
        "Select Allow access to add them to this deck's sharing list. You can also open the deck to review sharing first.",
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
