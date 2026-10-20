import { defineNitroPlugin } from "@agent-native/core/server";
import { startAgentNativeOtel } from "@agent-native/otel";

export default defineNitroPlugin(() => {
  startAgentNativeOtel();
});
