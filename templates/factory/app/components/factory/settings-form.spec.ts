import { describe, expect, it } from "vitest";

import {
  INITIAL_SETTINGS_FORM,
  formFromConfig,
  isDirty,
  saveInput,
  settingsFormReducer,
  trimmedForm,
  type FactoryConfig,
  type SettingsFormAction,
  type SettingsFormState,
} from "./settings-form";

const config: FactoryConfig = {
  automationFailureAlertsEnabled: false,
  automationFailureAlertEmail: "ops@example.test",
};

function run(...actions: SettingsFormAction[]): SettingsFormState {
  return actions.reduce(settingsFormReducer, INITIAL_SETTINGS_FORM);
}

describe("formFromConfig", () => {
  it("turns an unset config into the defaults a new factory has", () => {
    expect(formFromConfig({})).toEqual({
      failureAlertsEnabled: true,
      failureAlertEmail: "",
    });
  });

  it("reads nulls from the server as empty fields", () => {
    expect(
      formFromConfig({
        automationFailureAlertEmail: null,
      }),
    ).toMatchObject({ failureAlertEmail: "" });
  });
});

describe("settings form state", () => {
  it("has no form until the config has loaded", () => {
    expect(INITIAL_SETTINGS_FORM).toEqual({ baseline: null, draft: null });
    expect(isDirty(INITIAL_SETTINGS_FORM)).toBe(false);
    const edited = settingsFormReducer(INITIAL_SETTINGS_FORM, {
      type: "edit",
      patch: { failureAlertEmail: "a@example.test" },
    });
    expect(edited).toBe(INITIAL_SETTINGS_FORM);
  });

  it("is clean after load and dirty after an edit", () => {
    const loaded = run({ type: "loaded", config });
    expect(isDirty(loaded)).toBe(false);
    const edited = settingsFormReducer(loaded, {
      type: "edit",
      patch: { failureAlertEmail: "pager@example.test" },
    });
    expect(isDirty(edited)).toBe(true);
    expect(edited.baseline?.failureAlertEmail).toBe("ops@example.test");
  });

  it("keeps unsaved edits when a background refetch delivers new config", () => {
    const state = run(
      { type: "loaded", config },
      { type: "edit", patch: { failureAlertEmail: "typing@example.test" } },
      {
        type: "loaded",
        config: {
          ...config,
          automationFailureAlertEmail: "server@example.test",
        },
      },
    );
    expect(state.draft?.failureAlertEmail).toBe("typing@example.test");
    expect(state.baseline?.failureAlertEmail).toBe("ops@example.test");
  });

  it("takes new config from a refetch while the form is clean", () => {
    const state = run(
      { type: "loaded", config },
      {
        type: "loaded",
        config: {
          ...config,
          automationFailureAlertEmail: "server@example.test",
        },
      },
    );
    expect(state.draft?.failureAlertEmail).toBe("server@example.test");
    expect(isDirty(state)).toBe(false);
  });

  it("discards back to the last saved values", () => {
    const state = run(
      { type: "loaded", config },
      { type: "edit", patch: { failureAlertsEnabled: true } },
      { type: "discard" },
    );
    expect(state.draft).toEqual(state.baseline);
    expect(isDirty(state)).toBe(false);
  });
});

describe("saving", () => {
  it("saves trimmed values and shows them back", () => {
    const edited = run(
      { type: "loaded", config },
      { type: "edit", patch: { failureAlertEmail: "  pager@example.test  " } },
    );
    const submitted = trimmedForm(edited.draft!);
    expect(submitted.failureAlertEmail).toBe("pager@example.test");
    const saved = settingsFormReducer(edited, { type: "saved", submitted });
    expect(saved.draft?.failureAlertEmail).toBe("pager@example.test");
    expect(isDirty(saved)).toBe(false);
  });

  it("does not overwrite edits made while the save was in flight", () => {
    const edited = run(
      { type: "loaded", config },
      { type: "edit", patch: { failureAlertEmail: "first@example.test" } },
    );
    const submitted = trimmedForm(edited.draft!);
    const typedMeanwhile = settingsFormReducer(edited, {
      type: "edit",
      patch: { failureAlertEmail: "second@example.test" },
    });
    const saved = settingsFormReducer(typedMeanwhile, {
      type: "saved",
      submitted,
    });
    expect(saved.baseline?.failureAlertEmail).toBe("first@example.test");
    expect(saved.draft?.failureAlertEmail).toBe("second@example.test");
    expect(isDirty(saved)).toBe(true);
  });

  it("sends the factory id and the saved alert settings", () => {
    expect(saveInput("f1", formFromConfig(config))).toEqual({
      factoryId: "f1",
      automationFailureAlertsEnabled: false,
      automationFailureAlertEmail: "ops@example.test",
    });
  });
});
