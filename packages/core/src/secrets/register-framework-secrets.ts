/**
 * Framework-level secret registrations.
 *
 * Side-effect module — imported by the core-routes plugin at boot so the
 * sidebar settings UI and the `/_agent-native/secrets` list route surface the
 * relevant keys in every template.
 *
 * Each call uses a `getRequiredSecret` guard so a template that has already
 * registered the same key (often with stricter settings like `required: true`)
 * wins — the framework registration is a fallback, not an override.
 */

import { getRequiredSecret, registerRequiredSecret } from "./register.js";

/**
 * OpenAI API key.
 *
 * The framework uses this for voice transcription in the agent sidebar
 * composer (Whisper). Templates like Clips register it as `required: true`
 * in their own `register-secrets.ts`; the framework keeps it optional here
 * so every other template still surfaces the input without forcing the
 * onboarding checklist step.
 */
function registerOpenAiKey(): void {
  if (getRequiredSecret("OPENAI_API_KEY")) return;
  registerRequiredSecret({
    key: "OPENAI_API_KEY",
    label: "OpenAI API Key",
    description:
      "Used for voice transcription (Whisper) in the agent composer. Without this, voice input falls back to your browser's built-in speech recognition.",
    docsUrl: "https://platform.openai.com/api-keys",
    scope: "user",
    kind: "api-key",
    required: false,
    validator: async (value) => {
      if (!value || typeof value !== "string" || value.length < 20) {
        return { ok: false, error: "Key looks too short." };
      }
      try {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${value}` },
        });
        if (res.ok) return true;
        if (res.status === 401)
          return { ok: false, error: "OpenAI rejected this key (401)." };
        return { ok: false, error: `OpenAI returned ${res.status}.` };
      } catch (err: any) {
        return {
          ok: false,
          error: `Could not reach OpenAI: ${err?.message ?? err}`,
        };
      }
    },
  });
}

export function registerFrameworkSecrets(): void {
  registerOpenAiKey();
}
