// @agent-native/pinpoint — Framework integration exports
// MIT License

export {
  registerAdapter,
  detectFramework,
  getComponentInfo,
  getSourceLocation,
  resetDetection,
  getAdapters,
} from "./adapter.js";
export { reactAdapter, buildComponentPath } from "./react-adapter.js";
export { vueAdapter } from "./vue-adapter.js";
export { genericAdapter } from "./generic-adapter.js";
