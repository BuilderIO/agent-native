import { describe, expect, it } from "vitest";

import type { Translate } from "@/lib/translate";

import {
  draftErrors,
  draftToUpdate,
  type SettingsDraft,
} from "./settings-model";

const base: SettingsDraft = {
  isClosed: false,
  closedMessage: "",
  limitEnabled: false,
  submissionsLimit: "",
  closeEnabled: false,
  closeAt: "",
  redirectEnabled: false,
  redirectUrl: "",
  progressBar: false,
  autoJump: false,
  language: "en",
  partialSubmissions: false,
  saveForLater: true,
  submitLabel: "",
  passwordEnabled: false,
  passwordStored: false,
  password: "",
  duplicatesEnabled: false,
  uniqueKey: "respondent",
  retentionEnabled: false,
  retentionValue: "3",
  retentionUnit: "month",
  notifyOwner: false,
  ownerTo: "",
  notifyRespondent: false,
  respondentTo: "",
  respondentSubject: "",
  respondentMessage: "",
};

const t: Translate = (key) => key;

describe("form settings draft", () => {
  it("blocks a redirect that is not a web link", () => {
    expect(
      draftErrors({ ...base, redirectEnabled: true, redirectUrl: "nope" }, t),
    ).toHaveProperty("redirectUrl");
  });

  it("blocks a limit below one", () => {
    expect(
      draftErrors({ ...base, limitEnabled: true, submissionsLimit: "0" }, t),
    ).toHaveProperty("submissionsLimit");
  });

  it("asks for a password only when none is stored", () => {
    const on = { ...base, passwordEnabled: true };
    expect(draftErrors(on, t)).toHaveProperty("password");
    expect(draftErrors({ ...on, password: "x" }, t)).not.toHaveProperty(
      "password",
    );
    expect(draftErrors({ ...on, passwordStored: true }, t)).not.toHaveProperty(
      "password",
    );
  });

  it("blocks a retention period that is not a whole number of at least one", () => {
    const on = { ...base, retentionEnabled: true };
    expect(draftErrors({ ...on, retentionValue: "0" }, t)).toHaveProperty(
      "retentionValue",
    );
    expect(draftErrors({ ...on, retentionValue: "1.5" }, t)).toHaveProperty(
      "retentionValue",
    );
    expect(draftErrors({ ...on, retentionValue: "6" }, t)).toEqual({});
  });

  it("sends the password only when one was typed", () => {
    expect(
      draftToUpdate({ ...base, passwordEnabled: true }),
    ).not.toHaveProperty("password");
    expect(
      draftToUpdate({ ...base, passwordEnabled: true, password: "pw" }),
    ).toMatchObject({ password: "pw" });
  });

  it("clears the limit and close time when their switches are off", () => {
    const { settings } = draftToUpdate({
      ...base,
      submissionsLimit: "5",
      closeAt: "2027-01-01T10:00",
    });
    expect(settings.submissionsLimit).toBeNull();
    expect(settings.closeAt).toBeNull();
  });

  it("needs one to five valid owner addresses when the owner notification is on", () => {
    const on = { ...base, notifyOwner: true };
    expect(draftErrors(on, t)).toHaveProperty("ownerTo");
    expect(draftErrors({ ...on, ownerTo: "nope" }, t)).toHaveProperty(
      "ownerTo",
    );
    expect(
      draftErrors({ ...on, ownerTo: "a@example.test, b@example.test" }, t),
    ).not.toHaveProperty("ownerTo");
  });

  it("needs a chosen email question when the respondent notification is on", () => {
    const on = { ...base, notifyRespondent: true };
    expect(draftErrors({ ...on, respondentTo: "@" }, t)).toHaveProperty(
      "respondentTo",
    );
    const chosen = { ...on, respondentTo: "{{answer:q-email}}" };
    expect(draftErrors(chosen, t)).not.toHaveProperty("respondentTo");
    expect(draftToUpdate(chosen).settings.respondentEmail.toQuestionId).toBe(
      "q-email",
    );
  });
});

describe("submit button label", () => {
  it("keeps a typed label and trims it", () => {
    const update = draftToUpdate({ ...base, submitLabel: "  Send it in  " });
    expect(update.settings?.submitLabel).toBe("Send it in");
  });

  it("clears the label back to the built-in copy when the field is emptied", () => {
    const update = draftToUpdate({ ...base, submitLabel: "   " });
    expect(update.settings?.submitLabel).toBeUndefined();
  });
});
