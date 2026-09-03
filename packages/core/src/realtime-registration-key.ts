/**
 * Settings key holding this deployment's self-registered Realtime Gateway
 * channel (see `server/realtime-registration.ts`).
 *
 * It lives in its own module, next to the other change-marker keys, because
 * `poll.ts` has to skip it when wiring the settings emitter into the sync log
 * and cannot import the registration module without a cycle.
 */
export const REALTIME_REGISTRATION_SETTING_KEY =
  "agent-native-realtime-registration";
