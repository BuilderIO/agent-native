// @agent-native/pinpoint — Browser entry point (includes SolidJS UI)
// MIT License

// Re-export everything from main entry
export * from "./index.js";

export { mountPinpoint, unmountPinpoint } from "./ui/mount.js";
export { PinMarkerManager } from "./ui/components/PinMarker.js";

import { registerAdapter } from "./frameworks/adapter.js";
import { reactAdapter } from "./frameworks/react-adapter.js";
import { vueAdapter } from "./frameworks/vue-adapter.js";

registerAdapter(reactAdapter);
registerAdapter(vueAdapter);
