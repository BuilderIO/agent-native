import { emailStrong, renderEmail } from "@agent-native/core/server";

function stripCrlf(value: string | undefined): string {
  return (value ?? "").replace(/[\r\n]+/g, " ").trim();
}

export function renderOverlayRequestEmail({
  requesterName,
  requesterEmail,
  appLink,
}: {
  requesterName?: string;
  requesterEmail: string;
  appLink: string;
}) {
  const email = stripCrlf(requesterEmail);
  const name = stripCrlf(requesterName) || email;

  return {
    subject: `${name} would like to use your working hours for scheduling`,
    ...renderEmail({
      preheader: `${name} asked to be added to your calendar in Calendar.`,
      heading: "Add them back to see accurate times",
      paragraphs: [
        `${emailStrong(name)} (${emailStrong(email)}) has added your calendar in Calendar, and has booking links where you're a required host.`,
        "Right now those links can only see whether you're busy — not the working hours you've actually set. That means people can book you outside the times you'd normally accept.",
        `Adding ${emailStrong(name)} back to your own calendar fixes that. Nothing else about your calendar is shared.`,
      ],
      cta: { label: "Add them to my calendar", url: appLink },
      footer:
        "You received this because you're listed as a required host on one of their booking links. Reply to this email to reach them directly.",
    }),
  };
}
