/** The slice of `get-triage-config` that Settings edits or shows. */
export interface FactoryConfig {
  automationFailureAlertsEnabled?: boolean;
  automationFailureAlertEmail?: string | null;
  emailReadiness?: {
    status: "ready" | "not-configured" | "misconfigured" | "unavailable";
    provider: string;
  };
}

interface SettingsForm {
  failureAlertsEnabled: boolean;
  failureAlertEmail: string;
}

export function formFromConfig(config: FactoryConfig): SettingsForm {
  return {
    failureAlertsEnabled: config.automationFailureAlertsEnabled ?? true,
    failureAlertEmail: config.automationFailureAlertEmail ?? "",
  };
}

function sameForm(a: SettingsForm, b: SettingsForm): boolean {
  return (Object.keys(a) as (keyof SettingsForm)[]).every(
    (key) => a[key] === b[key],
  );
}

export function trimmedForm(form: SettingsForm): SettingsForm {
  return {
    ...form,
    failureAlertEmail: form.failureAlertEmail.trim(),
  };
}

export function saveInput(factoryId: string, form: SettingsForm) {
  return {
    factoryId,
    automationFailureAlertsEnabled: form.failureAlertsEnabled,
    automationFailureAlertEmail: form.failureAlertEmail,
  };
}

/**
 * `baseline` is what the server last said; `draft` is what the person sees.
 * Both are null until the config has loaded, so a form is never shown for a
 * config that was not read.
 */
export interface SettingsFormState {
  baseline: SettingsForm | null;
  draft: SettingsForm | null;
}

export const INITIAL_SETTINGS_FORM: SettingsFormState = {
  baseline: null,
  draft: null,
};

export type SettingsFormAction =
  | { type: "loaded"; config: FactoryConfig }
  | { type: "edit"; patch: Partial<SettingsForm> }
  | { type: "discard" }
  | { type: "saved"; submitted: SettingsForm };

export function isDirty(state: SettingsFormState): boolean {
  return (
    state.baseline !== null &&
    state.draft !== null &&
    !sameForm(state.baseline, state.draft)
  );
}

export function settingsFormReducer(
  state: SettingsFormState,
  action: SettingsFormAction,
): SettingsFormState {
  switch (action.type) {
    case "loaded": {
      // A background refetch must not wipe what the person is typing.
      if (isDirty(state)) return state;
      const next = formFromConfig(action.config);
      return { baseline: next, draft: next };
    }
    case "edit":
      return state.draft
        ? { ...state, draft: { ...state.draft, ...action.patch } }
        : state;
    case "discard":
      return { ...state, draft: state.baseline };
    case "saved": {
      // Edits made while the save was in flight stay as unsaved edits.
      const untouched =
        state.draft !== null &&
        sameForm(trimmedForm(state.draft), action.submitted);
      return {
        baseline: action.submitted,
        draft: untouched ? action.submitted : state.draft,
      };
    }
  }
}
