/**
 * Example Script: Create a New Composition Programmatically
 *
 * This script demonstrates how to create a new composition with all features:
 * - Camera track (6 properties)
 * - Cursor track (6 properties)
 * - Custom animation tracks
 * - Programmatic animations
 *
 * Usage:
 * 1. Copy this template
 * 2. Customize the values
 * 3. Run in browser console or integrate into your workflow
 */

import { addComposition, type CompositionEntry } from "@/remotion/registry";
import {
  createCameraTrack,
  createCursorTrack,
  createAnimationTrack,
  createFadeInTrack,
  createSlideInTrack,
  validateComposition,
  secondsToFrames,
} from "@/utils/compositionHelpers";
import { MyComponent } from "@/remotion/compositions/MyComponent"; // Your component

// ─── Configuration ────────────────────────────────────────────────────────────

const COMPOSITION_CONFIG = {
  id: "my-awesome-video",
  title: "My Awesome Video",
  description: "An example composition with all features enabled",
  durationInFrames: secondsToFrames(10), // 10 seconds at 30fps = 300 frames
  fps: 30,
  width: 1920,
  height: 1080,
};

// ─── Create Tracks ────────────────────────────────────────────────────────────

const tracks = [
  // Required: Camera track
  createCameraTrack(COMPOSITION_CONFIG.durationInFrames),

  // Required: Cursor track (for interactions)
  createCursorTrack(COMPOSITION_CONFIG.durationInFrames, {
    centerX: 960, // Center X for 1920×1080
    centerY: 540, // Center Y for 1920×1080
    easing: "expo.inOut",
  }),

  // Optional: Custom animation tracks
  createFadeInTrack("title-fade", "Title Fade In", 0, 30),

  createSlideInTrack("subtitle-slide", "Subtitle Slide", 15, 30, "left"),

  createAnimationTrack(
    "logo-entrance",
    "Logo Entrance",
    30,
    60,
    [
      { property: "scale", from: "0.5", to: "1", unit: "" },
      { property: "opacity", from: "0", to: "1", unit: "" },
      { property: "rotateY", from: "-90", to: "0", unit: "deg" },
    ],
    "spring",
  ),
];

// ─── Validate Composition ─────────────────────────────────────────────────────

const validation = validateComposition(tracks);

if (!validation.valid) {
  console.error("❌ Composition validation failed:");
  validation.errors.forEach((err) => console.error(`  - ${err}`));
  throw new Error("Invalid composition structure");
}

if (validation.warnings.length > 0) {
  console.warn("⚠️ Composition warnings:");
  validation.warnings.forEach((warn) => console.warn(`  - ${warn}`));
}

// ─── Create Composition Entry ─────────────────────────────────────────────────

const newComposition: CompositionEntry = {
  id: COMPOSITION_CONFIG.id,
  title: COMPOSITION_CONFIG.title,
  description: COMPOSITION_CONFIG.description,
  component: MyComponent,
  durationInFrames: COMPOSITION_CONFIG.durationInFrames,
  fps: COMPOSITION_CONFIG.fps,
  width: COMPOSITION_CONFIG.width,
  height: COMPOSITION_CONFIG.height,
  defaultProps: {
    // Your component's props
    backgroundColor: "#0a0a0a",
    accentColor: "#6366f1",
    title: "Hello World",
  },
  tracks,
};

// ─── Add to Registry ──────────────────────────────────────────────────────────

addComposition(newComposition);

console.log("✅ Composition created successfully!");
console.log(`   ID: ${newComposition.id}`);
console.log(`   Title: ${newComposition.title}`);
console.log(
  `   Duration: ${newComposition.durationInFrames} frames (${newComposition.durationInFrames / newComposition.fps}s)`,
);
console.log(`   Size: ${newComposition.width}×${newComposition.height}`);
console.log(`   Tracks: ${newComposition.tracks.length}`);

// ─── Navigate to New Composition ──────────────────────────────────────────────

// If running in React component context with useNavigate:
// navigate(`/c/${newComposition.id}`);

// If running in console:
// window.location.href = `/c/${newComposition.id}`;

export { newComposition };
