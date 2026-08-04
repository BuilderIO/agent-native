import {
  emailStrong,
  getAppProductionUrl,
  renderEmail,
  sendEmail,
} from "@agent-native/core/server";

import type { FormField } from "../../shared/types.js";

export interface NewResponseEmailArgs {
  to: string;
  formId: string;
  formTitle: string;
  fields: FormField[];
  data: Record<string, unknown>;
  submittedAt: string;
}

function stripCrlf(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function formatResponseValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formSettingsUrl(formId: string): string {
  const base = getAppProductionUrl().replace(/\/+$/, "");
  return `${base}/forms/${encodeURIComponent(formId)}`;
}

export function renderNewResponseEmail({
  formId,
  formTitle,
  fields,
  data,
  submittedAt,
}: Omit<NewResponseEmailArgs, "to">) {
  const safeTitle = stripCrlf(formTitle) || "Untitled form";
  const responseLines = fields
    .filter((field) => data[field.id] !== undefined)
    .map(
      (field) =>
        `${emailStrong(field.label)}: ${emailStrong(
          formatResponseValue(data[field.id]),
        )}`,
    );

  return {
    subject: `New response: ${safeTitle}`,
    ...renderEmail({
      preheader: `New response to ${safeTitle}`,
      heading: "New form response",
      paragraphs: [
        `${emailStrong(safeTitle)} received a new response.`,
        `Submitted at ${emailStrong(submittedAt)}.`,
        responseLines.length
          ? responseLines.join("<br />")
          : "No response fields were submitted.",
      ],
      footer:
        "You received this because email notifications are enabled in this {link}.",
      footerLink: { label: "form's settings", url: formSettingsUrl(formId) },
    }),
  };
}

export async function sendNewResponseEmail(
  args: NewResponseEmailArgs,
): Promise<void> {
  await sendEmail({
    to: args.to,
    ...renderNewResponseEmail(args),
  });
}
