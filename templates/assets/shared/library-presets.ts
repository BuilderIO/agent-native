import type { StyleBrief } from "./api.js";

export const DEFAULT_LIBRARY_PRESET_VERSION = 1;

export type LibraryPreset = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  styleBrief: StyleBrief;
  customInstructions: string;
  samplePrompts: string[];
};

export const DEFAULT_LIBRARY_PRESETS = [
  {
    id: "soft-travel-3d",
    title: "Soft Travel 3D",
    description:
      "Friendly tactile 3D miniatures for travel, hosting, services, lifestyle objects, and polished icon-like hero assets.",
    tags: ["3D", "travel", "icons"],
    styleBrief: {
      description:
        "Friendly, tactile 3D miniatures with rounded inflated geometry, satin clay or soft-plastic surfaces, simple white or lightly tinted backgrounds, natural materials, and premium lifestyle warmth. Keep the result legible at icon and hero scale without copying any branded app icon, logo, screenshot, or proprietary character.",
      palette: ["#ff5a5f", "#f7efe6", "#2e6f62", "#f2b880", "#5b6c8f"],
      composition:
        "Centered object or small vignette, 2-4 primary forms, generous negative space, consistent scale, readable silhouettes.",
      lighting:
        "Soft studio daylight from the upper front with gentle occlusion shadows and mild satin highlights.",
      typographyPolicy:
        "Avoid embedded text. Leave clean space for editable overlay text when text is needed.",
      doNot: [
        "Do not use travel marketplace logos, app screens, UI chrome, host photos, or exact icons.",
        "Do not copy screenshots or brand-owned compositions.",
        "Avoid glassy gradients, hard chrome, and hyper-real noise.",
      ],
    },
    customInstructions:
      "Use modern travel-marketplace 3D cues only as broad inspiration: tactile forms, warm hospitality, premium object clarity, and subtle motion-ready staging. Never mention or imitate a named brand in the output.",
    samplePrompts: [
      "A cozy mountain cabin key beside a ceramic coffee cup",
      "A chef service icon with folded linen, herbs, and a warm plate",
    ],
  },
  {
    id: "storybook-pastoral",
    title: "Storybook Pastoral",
    description:
      "Warm hand-painted landscapes and cozy scenes with watercolor texture, soft atmosphere, and editorial calm.",
    tags: ["painted", "warm", "editorial"],
    styleBrief: {
      description:
        "Warm hand-painted storybook scenes with watercolor and gouache texture, sunlit fields, cozy architecture, expressive clouds, rounded organic shapes, visible brush grain, and gentle cinematic framing. The mood should feel enchanting and handmade without referencing or copying a specific animation studio, film still, character, creature, or screenshot.",
      palette: ["#7fae80", "#e9c46a", "#f4a261", "#8ab6d6", "#6d597a"],
      composition:
        "Layered foreground, midground, and background with small human-scale details, a quiet sense of motion, and room for editorial crops.",
      lighting:
        "Golden-hour natural light, soft atmospheric haze, warm highlights, cool shaded greens and blues.",
      typographyPolicy:
        "Avoid text inside the image unless the prompt explicitly requests it.",
      doNot: [
        "Do not name or imitate a specific animation studio, director, or film.",
        "Do not include recognizable characters, creatures, logos, or film frames.",
        "Avoid exact screenshots and direct scene remakes.",
      ],
    },
    customInstructions:
      "Keep the look original and public-domain in spirit: painterly craft, pastoral warmth, and cinematic softness without copying any studio, artist, or franchise.",
    samplePrompts: [
      "A tiny hillside reading room during a summer rain",
      "A product launch announcement as a quiet market-town morning",
    ],
  },
  {
    id: "clay-studio",
    title: "Clay Studio",
    description:
      "Playful stop-motion style product imagery with handmade clay, felt, paper, and ceramic textures.",
    tags: ["clay", "product", "playful"],
    styleBrief: {
      description:
        "Tactile stop-motion product imagery using hand-built clay, felt, paper, and ceramic textures. Forms are playful, imperfect, sculpted, and macro-friendly, with visible fingerprints, soft bends, chunky props, and a clear handmade set.",
      palette: ["#f45b69", "#f7b267", "#2ec4b6", "#f4f1de", "#3d405b"],
      composition:
        "Small tabletop diorama with a clear subject, chunky supporting props, shallow depth, and a strong silhouette.",
      lighting:
        "Large softbox light, warm shadows, subtle material texture, and low-gloss surfaces.",
      typographyPolicy:
        "Prefer no embedded text. Use simple blank labels or signs only when the prompt asks for editable text space.",
      doNot: [
        "Avoid plastic toy clones or known character designs.",
        "Avoid polished CGI perfection.",
        "Do not render legible text unless requested.",
      ],
    },
    customInstructions:
      "Prioritize touchable materials, charming imperfections, and photographed set-piece realism over slick CGI.",
    samplePrompts: [
      "A chunky clay dashboard chart rising from a desk",
      "A social campaign image for a summer drink in a handmade studio set",
    ],
  },
  {
    id: "prismatic-paper-cut",
    title: "Prismatic Paper Cut",
    description:
      "Layered cut-paper compositions with crisp shadows, bold editorial shapes, and bright print-like color.",
    tags: ["paper", "editorial", "graphic"],
    styleBrief: {
      description:
        "Layered paper-cut collage with tactile paper fibers, crisp cast shadows, graphic geometric pieces, risograph-like color separation, and polished editorial composition. The image should feel hand-assembled, dimensional, and clean enough for campaigns or explainers.",
      palette: ["#e63946", "#f1fa8c", "#457b9d", "#2a9d8f", "#f4f4f2"],
      composition:
        "Flat-lay or shallow isometric arrangement with layered silhouettes, strong negative space, and a clear focal shape.",
      lighting:
        "Soft overhead studio light with precise paper-edge shadows and restrained texture.",
      typographyPolicy:
        "Reserve blank paper panels for text overlays instead of drawing text into the image.",
      doNot: [
        "Avoid mimicking a specific poster, album cover, artist, or campaign.",
        "Avoid photoreal objects that break the paper construction.",
        "Do not add watermarks or fake signatures.",
      ],
    },
    customInstructions:
      "Make every element look physically cut, stacked, and photographed; use color contrast for hierarchy instead of labels.",
    samplePrompts: [
      "A paper-cut explainer image for privacy controls",
      "A bold layered campaign graphic about neighborhood events",
    ],
  },
] satisfies LibraryPreset[];

export function getLibraryPreset(id: string): LibraryPreset | undefined {
  return DEFAULT_LIBRARY_PRESETS.find((preset) => preset.id === id);
}
