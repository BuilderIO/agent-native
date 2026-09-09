import type { StyleBrief } from "./api.js";

export const DEFAULT_LIBRARY_PRESET_VERSION = 2;

export type LibraryPresetReferenceImage = {
  id: string;
  title: string;
  description: string;
  path: string;
  sourceUrl: string;
  downloadUrl: string;
  sourceName: string;
  author: string;
  licenseName: string;
  licenseUrl: string;
};

export type LibraryPreset = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  styleBrief: StyleBrief;
  customInstructions: string;
  samplePrompts: string[];
  referenceImages: LibraryPresetReferenceImage[];
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
      "Use modern travel-marketplace 3D cues only as broad reference: tactile forms, warm hospitality, premium object clarity, and subtle motion-ready staging. Never mention or imitate a named brand in the output.",
    samplePrompts: [
      "A cozy mountain cabin key beside a ceramic coffee cup",
      "A chef service icon with folded linen, herbs, and a warm plate",
    ],
    referenceImages: [
      {
        id: "location-clay",
        title: "Soft clay location marker",
        description:
          "Rounded 3D location marker with warm clay-like surfaces and soft studio shadows.",
        path: "/library-presets/soft-travel-3d/location-clay.webp",
        sourceUrl:
          "https://commons.wikimedia.org/wiki/File:Location-dynamic-clay.png",
        downloadUrl:
          "https://commons.wikimedia.org/w/index.php?title=Special:Redirect/file/Location-dynamic-clay.png&width=900",
        sourceName: "Wikimedia Commons / 3dicons.co",
        author: "Vijay Verma",
        licenseName: "CC0 1.0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      },
      {
        id: "bag-clay",
        title: "Soft clay travel bag",
        description:
          "Tactile 3D bag object with inflated geometry and simple travel-marketplace warmth.",
        path: "/library-presets/soft-travel-3d/bag-clay.webp",
        sourceUrl:
          "https://commons.wikimedia.org/wiki/File:Bag-dynamic-clay.png",
        downloadUrl:
          "https://commons.wikimedia.org/w/index.php?title=Special:Redirect/file/Bag-dynamic-clay.png&width=900",
        sourceName: "Wikimedia Commons / 3dicons.co",
        author: "Vijay Verma",
        licenseName: "CC0 1.0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      },
      {
        id: "travel-clay",
        title: "Isometric travel miniature",
        description:
          "Compact travel-themed 3D icon reference for icon-scale object clarity.",
        path: "/library-presets/soft-travel-3d/travel-clay.webp",
        sourceUrl:
          "https://commons.wikimedia.org/wiki/File:Travel-iso-clay.png",
        downloadUrl:
          "https://commons.wikimedia.org/w/index.php?title=Special:Redirect/file/Travel-iso-clay.png&width=900",
        sourceName: "Wikimedia Commons / 3dicons.co",
        author: "Vijay Verma",
        licenseName: "CC0 1.0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      },
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
    referenceImages: [
      {
        id: "watercolor-bridge",
        title: "Peaceful watercolor landscape",
        description:
          "Public-domain watercolor landscape with a rustic bridge, soft greens, and gentle atmosphere.",
        path: "/library-presets/storybook-pastoral/watercolor-bridge.webp",
        sourceUrl:
          "https://commons.wikimedia.org/wiki/File:Peaceful_watercolor_landscape.jpg",
        downloadUrl:
          "https://commons.wikimedia.org/w/index.php?title=Special:Redirect/file/Peaceful_watercolor_landscape.jpg&width=900",
        sourceName: "Wikimedia Commons / Digital Commonwealth",
        author: "Unknown author",
        licenseName: "Public Domain Mark 1.0",
        licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
      },
      {
        id: "pastoral-wash",
        title: "Pastoral wash scene",
        description:
          "Public-domain pastoral scene with soft painterly texture, warm figures, and layered landscape depth.",
        path: "/library-presets/storybook-pastoral/pastoral-wash.webp",
        sourceUrl:
          "https://commons.wikimedia.org/wiki/File:Pastoral_landscape_with_women_preparing_the_wash_by_Jean-Baptiste_Hu%C3%ABt,_1777.jpg",
        downloadUrl:
          "https://commons.wikimedia.org/w/index.php?title=Special:Redirect/file/Pastoral_landscape_with_women_preparing_the_wash_by_Jean-Baptiste_Hu%C3%ABt,_1777.jpg&width=900",
        sourceName: "Wikimedia Commons",
        author: "Jean-Baptiste Huet",
        licenseName: "Public Domain Mark 1.0",
        licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
      },
      {
        id: "storybook-garden",
        title: "Garden storybook illustration",
        description:
          "Public-domain storybook watercolor reference for handmade linework, small-scale detail, and gentle color.",
        path: "/library-presets/storybook-pastoral/storybook-garden.webp",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:PotterCecily8.jpg",
        downloadUrl:
          "https://commons.wikimedia.org/w/index.php?title=Special:Redirect/file/PotterCecily8.jpg&width=900",
        sourceName: "Wikimedia Commons",
        author: "Beatrix Potter",
        licenseName: "Public Domain Mark 1.0",
        licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
      },
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
    referenceImages: [
      {
        id: "polymer-marbles",
        title: "Polymer clay marbles",
        description:
          "Handmade polymer clay marbles and ribbons showing bright color, fingerprints, and soft material edges.",
        path: "/library-presets/clay-studio/polymer-marbles.webp",
        sourceUrl:
          "https://commons.wikimedia.org/wiki/File:Colourful_ribbons_and_polymer_clay_marbles.jpg",
        downloadUrl:
          "https://commons.wikimedia.org/w/index.php?title=Special:Redirect/file/Colourful_ribbons_and_polymer_clay_marbles.jpg&width=900",
        sourceName: "Wikimedia Commons",
        author: "Annatsach",
        licenseName: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      },
      {
        id: "polymer-dice",
        title: "Handmade polymer clay dice",
        description:
          "Macro reference for sculpted clay objects with imperfect handmade geometry and shallow depth.",
        path: "/library-presets/clay-studio/polymer-dice.webp",
        sourceUrl:
          "https://commons.wikimedia.org/wiki/File:Dice_made_of_polymer_clay_(handmade).jpg",
        downloadUrl:
          "https://commons.wikimedia.org/w/index.php?title=Special:Redirect/file/Dice_made_of_polymer_clay_(handmade).jpg&width=900",
        sourceName: "Wikimedia Commons",
        author: "Annatsach",
        licenseName: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      },
      {
        id: "polymer-pendants",
        title: "Polymer clay pendants",
        description:
          "Colorful handmade pendant set with tactile sculpted edges and photographed craft-table realism.",
        path: "/library-presets/clay-studio/polymer-pendants.webp",
        sourceUrl:
          "https://commons.wikimedia.org/wiki/File:Pendants_made_of_polymer_clay_(handmade).jpg",
        downloadUrl:
          "https://commons.wikimedia.org/w/index.php?title=Special:Redirect/file/Pendants_made_of_polymer_clay_(handmade).jpg&width=900",
        sourceName: "Wikimedia Commons",
        author: "Annatsach",
        licenseName: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      },
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
    referenceImages: [
      {
        id: "paper-rainbow",
        title: "Layered paper rainbow",
        description:
          "Bright stacked paper reference for color rhythm, curled edges, and visible paper texture.",
        path: "/library-presets/prismatic-paper-cut/paper-rainbow.webp",
        sourceUrl:
          "https://commons.wikimedia.org/wiki/File:Paper_Rainbow_(14050350997).jpg",
        downloadUrl:
          "https://commons.wikimedia.org/w/index.php?title=Special:Redirect/file/Paper_Rainbow_(14050350997).jpg&width=900",
        sourceName: "Wikimedia Commons / Flickr",
        author: "D. Sharon Pruitt",
        licenseName: "CC BY 2.0",
        licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
      },
      {
        id: "kirigami",
        title: "Folded kirigami structure",
        description:
          "Dimensional cut-and-fold paper construction with crisp shadows and shallow depth.",
        path: "/library-presets/prismatic-paper-cut/kirigami.webp",
        sourceUrl:
          "https://commons.wikimedia.org/wiki/File:Kirigami_Basico.jpg",
        downloadUrl:
          "https://commons.wikimedia.org/w/index.php?title=Special:Redirect/file/Kirigami_Basico.jpg&width=900",
        sourceName: "Wikimedia Commons",
        author: "Hin27al",
        licenseName: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      },
      {
        id: "paper-cutout",
        title: "Historic paper cutout",
        description:
          "Public-domain paper-cut craft reference for clean negative space, fine edges, and handmade precision.",
        path: "/library-presets/prismatic-paper-cut/lords-prayer-cutout.webp",
        sourceUrl:
          "https://commons.wikimedia.org/wiki/File:Paper_cut-out_with_The_Lord%27s_Prayer_MET_DP372401.jpg",
        downloadUrl:
          "https://commons.wikimedia.org/w/index.php?title=Special:Redirect/file/Paper_cut-out_with_The_Lord%27s_Prayer_MET_DP372401.jpg&width=900",
        sourceName: "Wikimedia Commons / The Metropolitan Museum of Art",
        author: "Unknown author",
        licenseName: "CC0 1.0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      },
    ],
  },
] satisfies LibraryPreset[];

export function getLibraryPreset(id: string): LibraryPreset | undefined {
  return DEFAULT_LIBRARY_PRESETS.find((preset) => preset.id === id);
}
