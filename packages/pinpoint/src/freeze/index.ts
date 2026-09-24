// @agent-native/pinpoint — Freeze exports
// MIT License

export {
  freeze,
  unfreeze,
  isFreezeActive,
  type FreezeOptions,
} from "./controller.js";
export { freezeCSS } from "./css-freeze.js";
export { freezeWAAPI } from "./waapi-freeze.js";
export { freezeReact, isReactFrozen } from "./react-freeze.js";
export { freezeMedia } from "./media-freeze.js";
export { freezeJSTimers, markInternal } from "./js-freeze.js";
