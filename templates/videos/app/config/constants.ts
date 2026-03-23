/**
 * Application Constants
 *
 * Centralized configuration values to avoid magic numbers
 * and maintain consistency across the application.
 */

/**
 * Animation Configuration
 */
export const ANIMATION_CONFIG = {
  /** Default frames per second for compositions */
  DEFAULT_FPS: 30,

  /** Default composition duration in frames */
  DEFAULT_DURATION: 240,

  /** Minimum playback rate */
  MIN_PLAYBACK_RATE: 0.25,

  /** Maximum playback rate */
  MAX_PLAYBACK_RATE: 4,

  /** Default easing curve */
  DEFAULT_EASING: "expo.out" as const,
} as const;

/**
 * Cursor Configuration
 */
export const CURSOR_CONFIG = {
  /** Cursor size in pixels */
  SIZE: 32,

  /** Default cursor opacity */
  DEFAULT_OPACITY: 1,

  /** Default cursor scale */
  DEFAULT_SCALE: 1,

  /** Hover detection padding in pixels */
  HOVER_PADDING: 15,
} as const;

/**
 * Card Configuration
 */
export const CARD_CONFIG = {
  /** Card width in pixels */
  WIDTH: 285,

  /** Card height in pixels */
  HEIGHT: 200,

  /** Default border radius in pixels */
  BORDER_RADIUS: 16,

  /** Default border width in pixels */
  BORDER_WIDTH: 2,

  /** Default border opacity */
  BORDER_OPACITY: 0.2,

  /** Default background opacity */
  BACKGROUND_OPACITY: 1,

  /** Default shadow blur in pixels */
  SHADOW_BLUR: 8,

  /** Default shadow spread in pixels */
  SHADOW_SPREAD: 0,
} as const;

/**
 * UI Configuration
 */
export const UI_CONFIG = {
  /** Property label minimum width in pixels */
  PROPERTY_LABEL_WIDTH: 80,

  /** Standard input height in pixels */
  INPUT_HEIGHT: 28,

  /** Sidebar width (open) in pixels */
  SIDEBAR_WIDTH: 288, // 72 * 4 = 18rem

  /** Timeline track height in pixels */
  TRACK_HEIGHT: 36,

  /** Keyframe diamond size in pixels */
  KEYFRAME_SIZE: 8,

  /** Keyframe clickable area in pixels */
  KEYFRAME_CLICKABLE: 24,
} as const;

/**
 * Timeline Configuration
 */
export const TIMELINE_CONFIG = {
  /** Minimum zoom level */
  MIN_ZOOM: 0.1,

  /** Maximum zoom level */
  MAX_ZOOM: 10,

  /** Default zoom level */
  DEFAULT_ZOOM: 1,

  /** Zoom step increment */
  ZOOM_STEP: 0.1,
} as const;

/**
 * Color Palette
 */
export const COLORS = {
  /** Camera track color */
  CAMERA: "#3b82f6", // blue-500

  /** Cursor track color */
  CURSOR: "#a855f7", // purple-500

  /** Interaction color (hover/click) */
  INTERACTION: "#ef4444", // red-500

  /** Click indicator dot color */
  CLICK_DOT: "#facc15", // yellow-400

  /** Default background color */
  DEFAULT_BG: "#3b82f6", // blue-500

  /** Default border color */
  DEFAULT_BORDER: "#ffffff", // white
} as const;

/**
 * Storage Keys
 */
export const STORAGE_KEYS = {
  /** Prefix for localStorage keys */
  PREFIX: "videos",

  /** Tracks storage key */
  tracks: (compositionId: string) => `videos-tracks-${compositionId}`,

  /** Props storage key */
  props: (compositionId: string) => `videos-props-${compositionId}`,

  /** Composition settings storage key */
  settings: (compositionId: string) => `videos-comp-settings-${compositionId}`,

  /** Element animations storage key */
  elementAnimations: (compositionId: string) =>
    `videos-element-animations-${compositionId}`,
} as const;

/**
 * Validation Limits
 */
export const LIMITS = {
  /** Maximum composition duration in seconds */
  MAX_DURATION_SECONDS: 600, // 10 minutes

  /** Maximum number of keyframes per property */
  MAX_KEYFRAMES: 1000,

  /** Maximum number of tracks per composition */
  MAX_TRACKS: 50,

  /** Maximum file attachment size in bytes (10MB) */
  MAX_ATTACHMENT_SIZE: 10 * 1024 * 1024,
} as const;

/**
 * Default Values
 */
export const DEFAULTS = {
  /** Default hover animation duration in frames */
  HOVER_DURATION: 6,

  /** Default click animation duration in frames */
  CLICK_DURATION: 12,

  /** Default composition format */
  FORMAT: "wide" as const,

  /** Default composition background */
  BACKGROUND: "#0a0a0a" as const,
} as const;

/**
 * Feature Flags
 */
export const FEATURES = {
  /** Enable debug logging */
  DEBUG: import.meta.env.DEV,

  /** Enable verbose logging */
  VERBOSE: import.meta.env.VITE_DEBUG_VERBOSE === "true",

  /** Enable frame-by-frame logging */
  FRAME_LOGGING: import.meta.env.VITE_DEBUG_FRAMES === "true",
} as const;
