import {
  MAX_NOTIFY_RECIPIENTS,
  type FormDetail,
  type RetentionUnit,
} from "@shared/form-contract";
import { mentionToken, parseMentions } from "@shared/form-model";

import type { Translate } from "@/lib/translate";

export type SettingsDraft = {
  isClosed: boolean;
  closedMessage: string;
  limitEnabled: boolean;
  submissionsLimit: string;
  closeEnabled: boolean;
  /** Value of a datetime-local input: local time, minutes precision. */
  closeAt: string;
  redirectEnabled: boolean;
  redirectUrl: string;
  progressBar: boolean;
  autoJump: boolean;
  language: string;
  partialSubmissions: boolean;
  saveForLater: boolean;
  /** Empty means the built-in "Submit". */
  submitLabel: string;
  passwordEnabled: boolean;
  /** A password is already stored, so enabling needs no new one. */
  passwordStored: boolean;
  /** Only what the author typed this session; the stored one is never read back. */
  password: string;
  duplicatesEnabled: boolean;
  /** "respondent", "ip" or "field:<questionId>". */
  uniqueKey: string;
  retentionEnabled: boolean;
  retentionValue: string;
  retentionUnit: RetentionUnit;
  notifyOwner: boolean;
  /** Addresses separated by commas or spaces. */
  ownerTo: string;
  notifyRespondent: boolean;
  /** A mention token while an email question is chosen, otherwise whatever was typed. */
  respondentTo: string;
  respondentSubject: string;
  respondentMessage: string;
};

export const parseAddresses = (text: string) =>
  text.split(/[,;\s]+/).filter(Boolean);

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const respondentQuestionId = (respondentTo: string) =>
  parseMentions(respondentTo).flatMap((segment) =>
    segment.type === "mention" && segment.ref.kind === "answer"
      ? [segment.ref.questionId]
      : [],
  )[0] ?? "";

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" }, // i18n-ignore — endonym, same in every locale
  { code: "fr", label: "Français" }, // i18n-ignore — endonym, same in every locale
  { code: "de", label: "Deutsch" },
  { code: "pt", label: "Português" }, // i18n-ignore — endonym, same in every locale
  { code: "ja", label: "日本語" }, // i18n-ignore — endonym, same in every locale
] as const;

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function draftFromForm(form: FormDetail): SettingsDraft {
  const { settings } = form;
  return {
    isClosed: form.isClosed,
    closedMessage: settings.closedMessage ?? "",
    limitEnabled: typeof settings.submissionsLimit === "number",
    submissionsLimit: String(settings.submissionsLimit ?? ""),
    closeEnabled: Boolean(settings.closeAt),
    closeAt: toLocalInput(settings.closeAt),
    redirectEnabled: settings.redirectOnCompletion?.enabled ?? false,
    redirectUrl: settings.redirectOnCompletion?.url ?? "",
    progressBar: settings.progressBar ?? false,
    autoJump: settings.autoJump ?? false,
    language: settings.language ?? "en",
    partialSubmissions: settings.partialSubmissions ?? false,
    saveForLater: settings.saveAnswersForLater ?? true,
    submitLabel: settings.submitLabel ?? "",
    passwordEnabled: settings.passwordProtected ?? false,
    passwordStored: settings.passwordProtected ?? false,
    password: "",
    duplicatesEnabled: settings.preventDuplicates ?? false,
    uniqueKey: settings.uniqueSubmissionKey ?? "respondent",
    retentionEnabled: settings.dataRetention?.enabled ?? false,
    retentionValue: String(settings.dataRetention?.value ?? 3),
    retentionUnit: settings.dataRetention?.unit ?? "month",
    notifyOwner: settings.selfEmail?.enabled ?? false,
    ownerTo: (settings.selfEmail?.to ?? []).join(", "),
    notifyRespondent: settings.respondentEmail?.enabled ?? false,
    respondentTo: settings.respondentEmail?.toQuestionId
      ? mentionToken({
          kind: "answer",
          questionId: settings.respondentEmail.toQuestionId,
        })
      : "",
    respondentSubject: settings.respondentEmail?.subject ?? "",
    respondentMessage: settings.respondentEmail?.message ?? "",
  };
}

export function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === "http:" || protocol === "https:";
}

/** The first problem that blocks saving, keyed by the field it belongs to. */
export function draftErrors(
  draft: SettingsDraft,
  t: Translate,
): {
  submissionsLimit?: string;
  closeAt?: string;
  redirectUrl?: string;
  password?: string;
  retentionValue?: string;
  ownerTo?: string;
  respondentTo?: string;
} {
  const errors: ReturnType<typeof draftErrors> = {};
  const limit = Number(draft.submissionsLimit);
  if (draft.limitEnabled && !(Number.isInteger(limit) && limit >= 1))
    errors.submissionsLimit = t("forms.settings.limitInvalid");
  if (draft.closeEnabled && Number.isNaN(Date.parse(draft.closeAt)))
    errors.closeAt = t("forms.settings.closeAtInvalid");
  if (draft.redirectEnabled && !isHttpUrl(draft.redirectUrl))
    errors.redirectUrl = t("forms.settings.redirectInvalid");
  if (draft.passwordEnabled && !draft.passwordStored && !draft.password)
    errors.password = t("forms.collection.passwordMissing");
  const retention = Number(draft.retentionValue);
  if (
    draft.retentionEnabled &&
    !(Number.isInteger(retention) && retention >= 1)
  )
    errors.retentionValue = t("forms.collection.retentionInvalid");
  const owners = parseAddresses(draft.ownerTo);
  if (
    draft.notifyOwner &&
    !(
      owners.length >= 1 &&
      owners.length <= MAX_NOTIFY_RECIPIENTS &&
      owners.every(isEmail)
    )
  )
    errors.ownerTo = t("forms.notify.toInvalid", {
      count: MAX_NOTIFY_RECIPIENTS,
    });
  if (draft.notifyRespondent && !respondentQuestionId(draft.respondentTo))
    errors.respondentTo = t("forms.notify.respondentToMissing");
  return errors;
}

export function draftToUpdate(draft: SettingsDraft) {
  return {
    isClosed: draft.isClosed,
    settings: {
      closedMessage: draft.closedMessage,
      submissionsLimit: draft.limitEnabled
        ? Number(draft.submissionsLimit)
        : null,
      closeAt: draft.closeEnabled
        ? new Date(draft.closeAt).toISOString()
        : null,
      redirectOnCompletion: {
        enabled: draft.redirectEnabled,
        url: draft.redirectUrl,
      },
      progressBar: draft.progressBar,
      autoJump: draft.autoJump,
      language: draft.language,
      partialSubmissions: draft.partialSubmissions,
      saveAnswersForLater: draft.saveForLater,
      submitLabel: draft.submitLabel.trim() || undefined,
      passwordProtected: draft.passwordEnabled,
      preventDuplicates: draft.duplicatesEnabled,
      uniqueSubmissionKey: draft.uniqueKey,
      dataRetention: {
        enabled: draft.retentionEnabled,
        value: Number(draft.retentionValue),
        unit: draft.retentionUnit,
      },
      selfEmail: {
        enabled: draft.notifyOwner,
        to: parseAddresses(draft.ownerTo).filter(isEmail),
      },
      respondentEmail: {
        enabled: draft.notifyRespondent,
        toQuestionId: respondentQuestionId(draft.respondentTo),
        subject: draft.respondentSubject,
        message: draft.respondentMessage,
      },
    },
    ...(draft.passwordEnabled && draft.password
      ? { password: draft.password }
      : {}),
  };
}
