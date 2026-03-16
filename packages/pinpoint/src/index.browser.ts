// @agent-native/pinpoint — Browser entry point (includes SolidJS UI)
// MIT License

// Re-export everything from main entry
export * from "./index.js";

// UI-specific exports
export { mountPinpoint, unmountPinpoint } from "./ui/mount.js";
export { PinMarkerManager } from "./ui/components/PinMarker.js";

// Auto-register framework adapters
import { registerAdapter } from "./frameworks/adapter.js";
import { reactAdapter } from "./frameworks/react-adapter.js";
import { vueAdapter } from "./frameworks/vue-adapter.js";

registerAdapter(reactAdapter);
registerAdapter(vueAdapter);
