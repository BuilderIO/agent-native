import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { formSettingsSchema } from "../shared/form-contract.js";
import { deriveQuestions } from "../shared/form-model/index.js";
import { sanitizeCss } from "../shared/theme/form-theme.js";
import { formsAccess, formsErrors, nowIso, requireForm } from "./_access.js";
import { hashPassword } from "./_collection.js";

export default defineAction({
  description:
    "Change form settings: merge a partial settings patch (closed message, submissions limit, close time, redirect, progress bar, auto-jump, language, partialSubmissions, saveAnswersForLater, passwordProtected (with `password`), preventDuplicates (with uniqueSubmissionKey: respondent, ip or field:<questionId>), dataRetention {enabled, value, unit}, selfEmail {enabled, to: up to 5 addresses} (mail the answers on each completed submission), respondentEmail {enabled, toQuestionId (an email question id), subject, message; both may hold {{answer:<questionId>}} and {{meta:form-name|submission-id|respondent-id}} tokens} (confirmation to the address the respondent gave), theme, customCss) and/or open or close the form.",
  schema: z.object({
    id: z.string().describe("Form id"),
    settings: formSettingsSchema
      .partial()
      .optional()
      .describe(
        "Settings keys to change; other keys are kept. `theme` replaces the whole theme object. Core: preset, font, background, text, accent, buttonBackground, buttonText (colours #rrggbb or #rrggbbaa), pageWidth, baseFontSize (px). Images (hosted URLs): logoUrl with logoWidth, logoHeight, logoRadius; coverUrl with coverHeight (% of viewport height); backgroundImageUrl with backgroundImageSize (cover|contain) and backgroundImageAttachment (fixed|scroll). Inputs: inputWidthMode (fixed|full), inputWidth, inputHeight, inputBackground, inputPlaceholder, inputBorderColor, inputBorderWidth, fieldRadius, inputMarginBottom, inputPaddingX. Buttons: buttonWidthMode (auto|full|fixed), buttonWidth, buttonHeight, buttonAlign (left|center|right), buttonFontSize, buttonRadius, buttonMarginY, buttonPaddingX. Lengths are integer px; `customCss` (max 20 KB) styles the preview and public form only, through the .forms-* class hooks.",
      ),
    password: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "New respondent password; write-only and stored as a hash. Needed to turn passwordProtected on the first time.",
      ),
    isClosed: z
      .boolean()
      .optional()
      .describe("true closes the form to new responses"),
  }),
  outputSchema: z.object({
    id: z.string(),
    settings: formSettingsSchema,
    isClosed: z.boolean(),
  }),
  errors: formsErrors,
  run: async ({ id, settings, password, isClosed }) => {
    const access = formsAccess();
    const { form } = await requireForm(access, id);
    const merged = { ...form.settings, ...settings };
    if (settings?.customCss !== undefined)
      merged.customCss = sanitizeCss(settings.customCss);
    const respondentMail = merged.respondentEmail;
    if (
      respondentMail?.enabled === true &&
      respondentMail.toQuestionId &&
      !deriveQuestions([
        ...form.publishedBlocks,
        ...(form.draftBlocks ?? []),
      ]).some(
        (question) =>
          question.id === respondentMail.toQuestionId &&
          question.type === "INPUT_EMAIL",
      )
    )
      return formsErrors.noWrite(
        "Choose an email question for the respondent notification.",
        "invalid_input",
        { statusCode: 400 },
      );
    const closed = isClosed ?? form.isClosed;
    const passwordHash = password
      ? await hashPassword(password)
      : merged.passwordProtected === true
        ? form.passwordHash
        : null;
    if (merged.passwordProtected === true && !passwordHash)
      return formsErrors.noWrite(
        "Set a password to protect the form.",
        "invalid_input",
        { statusCode: 400 },
      );
    await getDb()
      .update(schema.forms)
      .set({
        settings: merged,
        isClosed: closed,
        passwordHash,
        updatedAt: nowIso(),
      })
      .where(eq(schema.forms.id, id));
    return { id, settings: merged, isClosed: closed };
  },
});
