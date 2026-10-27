import { createReactComponent } from "@tabler/icons-react";

/**
 * Voice chat's glyph: a five-bar waveform. Tabler has no bar waveform, and
 * `IconWaveSine` reads as a heartbeat. Built with Tabler's factory so it takes
 * the same `size`, `stroke`, and `className` props as every other icon.
 */
export const IconVoiceChat = createReactComponent(
  "outline",
  "voice-chat",
  "VoiceChat",
  [
    ["path", { d: "M4 10v4", key: "svg-0" }],
    ["path", { d: "M8 7v10", key: "svg-1" }],
    ["path", { d: "M12 4v16", key: "svg-2" }],
    ["path", { d: "M16 7v10", key: "svg-3" }],
    ["path", { d: "M20 10v4", key: "svg-4" }],
  ],
);
