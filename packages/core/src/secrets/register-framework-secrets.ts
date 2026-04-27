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
 *
 * NOTE: The framework previously registered OPENAI_API_KEY here for Whisper
 * voice transcription. Voice transcription now routes through the Builder.io
 * gateway (or Groq as a BYOK fallback), so the framework no longer registers
 * the OpenAI key. Templates that need it (e.g. Clips) register it themselves.
 */

export function registerFrameworkSecrets(): void {
  // No framework-level secrets at this time.
  // Templates register their own keys via `registerRequiredSecret` in
  // their own `register-secrets.ts`.
}
