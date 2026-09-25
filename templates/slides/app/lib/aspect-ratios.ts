// Re-export from shared so client (app/) and server (actions/) share one source of truth.
export {
  ASPECT_RATIOS,
  ASPECT_RATIO_VALUES,
  DEFAULT_ASPECT_RATIO,
  getAspectRatioDims,
  type AspectRatio,
} from "@shared/aspect-ratios";
