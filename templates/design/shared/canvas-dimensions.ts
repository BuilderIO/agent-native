import { allFrameSizePresets } from "./frame-size-presets.js";
import {
  MAX_SANE_FRAME_ASPECT_RATIO,
  MAX_SANE_FRAME_DIMENSION_PX,
} from "./responsive-frame-layout.js";

export interface CanvasDimensions {
  width: number;
  height: number;
}

const DIMENSION_PAIR =
  /(?<![\d.,])(-?(?:\d{1,3}(?:,\d{3})+|\d+))\s*(px|pixels?)?\s*(?:x|×|by)\s*(-?(?:\d{1,3}(?:,\d{3})+|\d+))\s*(px|pixels?)?(?!\w)/gi;
const DIMENSION_CONTEXT_BEFORE =
  /\b(?:exact(?:ly)?|fixed[- ]size|dimensions?|size|canvas|artboard|frame|screen|pixels?)\s*(?:(?:to|at)\s*)?(?:[:=]\s*)?$/i;
const DIMENSION_CONTEXT_AFTER =
  /^\s*(?:canvas|artboard|frame|screen|(?:exact(?:ly)?\s+)?(?:dimensions?|size))\b/i;
const FORMAT_CONTEXT_BEFORE =
  /\b(?:ad|advertisement|banner|leaderboard|rectangle|skyscraper|billboard|cover|favicon|logo|avatar|social\s+post|post|story|email\s+header|email|newsletter|print|flyer|poster|screenshot)(?:\s+(?:at|for|of|in|with|size|dimensions?))?\s*[:,;]?\s*$/i;
const FORMAT_CONTEXT_AFTER =
  /^\s*(?:(?:for|as|in)\s+(?:an?\s+)?)?(?:(?:linkedin|meta|facebook|instagram|twitter|x|youtube|google)\s+)?(?:(?:single[\s-]?image|feed|social(?:\s+media)?)\s+)?(?:ads?|advertisements?|banner|leaderboard|rectangle|skyscraper|billboard|cover|favicon|logo|avatar|post|story|thumbnail|email\s+header|email|newsletter|print|flyer|poster|screenshot)\b/i;
const OUTPUT_FORMAT_CONTEXT_BEFORE_AT =
  /\b(?:ads?|advertisements?|banners?|leaderboards?|rectangles?|skyscrapers?|billboards?|covers?|social\s+posts?|posts?|stories|thumbnails?|email\s+headers?|flyers?|posters?|screenshots?)\b[\s\S]{0,32}\bat\s*$/i;
const LAYOUT_COUNT_CONTEXT_AFTER =
  /^\s*(?:(?:card\s+)?(?:grid|matrix|layout)|columns?|rows?)\b/i;
const ASPECT_RATIO_CONTEXT_AFTER = /^\s*(?:aspect\s+ratio|ratio)\b/i;
const ASPECT_RATIO_CONTEXT_BEFORE =
  /\b(?:aspect\s+)?ratio\b(?:\s+(?:of|is|to))?\s*[:=]?\s*$/i;
const OUTPUT_LAYOUT_AT_SIZE_CONTEXT_BEFORE =
  /\b(?:card\s+)?(?:grid|matrix|layout)\s+at\s*$/i;
const IMAGE_OUTPUT_CONTEXT_BEFORE =
  /\bimage\s+(?:(?:at|of)\s*|with\s+(?:exact(?:ly)?\s+)?(?:dimensions?|size)\s*)?$/i;
const OUTPUT_CONTEXT_BEFORE_SEPARATOR =
  /\b(?:screens?|canvas|artboard|frame)\s*[:,;]\s*$/i;
const EXPLICIT_CANVAS_DIMENSION_CONTEXT_BEFORE =
  /\b(?:exact(?:ly)?\s+)?(?:canvas|artboard|frame|screen)\s+(?:(?:with|at)\s+)?(?:exact(?:ly)?\s+)?(?:dimensions?|size)(?:\s+(?:of|is|at|to))?\s*(?:[:=]\s*)?$/i;
const ASSET_CONTEXT_AFTER =
  /^\s*(?:[a-z-]+\s+){0,3}(?:image|asset|icon|logo|favicon|avatar|illustration)\b/i;
const PIXEL_ASSET_CONTEXT_AFTER =
  /^\s*(?:image|asset|icon|logo|favicon|avatar|illustration)\b/i;
const SCREEN_CONTAINER_CONTEXT = "(?:screen|canvas|artboard|frame)";
const PAGE_CONTAINER_CONTEXT =
  "(?:(?:responsive\\s+)?(?:landing\\s+)?page|web\\s+app|website|web\\s+site|dashboard)";
const OUTPUT_CONTAINER_CONTEXT =
  "(?:screen|canvas|artboard|frame|(?:responsive\\s+)?(?:landing\\s+)?page|web\\s+app|website|web\\s+site|dashboard|ad|advertisement|banner|leaderboard|rectangle|skyscraper|billboard|cover|social\\s+post|post|story|email\\s+header|email|newsletter|print|flyer|poster|screenshot)";
const NESTED_OUTPUT_ASSET_AFTER =
  /^\s*(?:[a-z-]+\s+){0,3}(?:image|asset|icon|logo|favicon|avatar|illustration|ad|advertisement|banner|leaderboard|rectangle|skyscraper|billboard)\b/i;
const NESTED_OUTPUT_RELATIONSHIP_BEFORE = new RegExp(
  `\\b${OUTPUT_CONTAINER_CONTEXT}\\b[\\s\\S]{0,48}(?:\\b(?:with|including|containing|inside|featuring|using|for)\\s+(?:an?|the)?\\s*(?:[a-z-]+\\s+){0,3}|\\b(?:that|which)\\s+(?:includes|contains|features|has)\\s+(?:an?|the)?\\s*(?:[a-z-]+\\s+){0,3}|\\band\\s+(?:include|add|insert|place|put|use)\\s+(?:an?|the)?\\s*(?:[a-z-]+\\s+){0,3}|[.!?:;,]\\s*(?:add|insert|place|put|include|use)\\s+(?:an?|the)?\\s*(?:[a-z-]+\\s+){0,3})$`,
  "i",
);
const NESTED_PAGE_RELATIONSHIP_BEFORE = new RegExp(
  `\\b${PAGE_CONTAINER_CONTEXT}\\b[\\s\\S]{0,96}(?:\\b(?:with|including|containing|inside|featuring|using|for|and)\\s+(?:an?|the)?\\s*(?:[a-z-]+\\s+){0,3}|\\b(?:that|which)\\s+(?:includes|contains|features|has)\\s+(?:an?|the)?\\s*(?:[a-z-]+\\s+){0,3}|[.!?:;,]\\s*(?:add|insert|place|put|include|use)\\s+(?:an?|the)?\\s*(?:[a-z-]+\\s+){0,3})$`,
  "i",
);
const NESTED_SCREEN_SIBLING_RELATIONSHIP_BEFORE = new RegExp(
  `\\b${SCREEN_CONTAINER_CONTEXT}\\b[\\s\\S]{0,96}\\b(?:image|asset|icon|logo|favicon|avatar|illustration|ad|advertisement|banner|leaderboard|rectangle|skyscraper|billboard)\\b[\\s\\S]{0,24}\\band\\s+(?:an?|the)?\\s*$`,
  "i",
);
const NESTED_ASSET_FOR_OUTPUT_AFTER = new RegExp(
  `\\b(?:image|asset|icon|logo|favicon|avatar|illustration|ad|advertisement|banner|leaderboard|rectangle|skyscraper|billboard)\\b[\\s\\S]{0,32}\\bfor\\s+(?:an?\\s+)?${OUTPUT_CONTAINER_CONTEXT}\\s*(?:\\b(?:at|with|of|size|dimensions?)\\b\\s*)?$`,
  "i",
);
const NESTED_OUTPUT_ASSET_CONTEXT_BEFORE = new RegExp(
  `\\b${OUTPUT_CONTAINER_CONTEXT}\\b[\\s\\S]{0,48}(?:\\b(?:with|including|containing|inside|featuring|using|for)\\s+(?:an?|the)?\\s*(?:[a-z-]+\\s+){0,3}|\\b(?:that|which)\\s+(?:includes|contains|features|has)\\s+(?:an?|the)?\\s*(?:[a-z-]+\\s+){0,3}|\\band\\s+(?:include|add|insert|place|put|use)\\s+(?:an?|the)?\\s*(?:[a-z-]+\\s+){0,3}|[.!?:;,]\\s*(?:add|insert|place|put|include|use)\\s+(?:an?|the)?\\s*(?:[a-z-]+\\s+){0,3})(?:[a-z-]+\\s+){0,3}(?:image|asset|icon|logo|favicon|avatar|illustration|ad|advertisement|banner|leaderboard|rectangle|skyscraper|billboard)\\s+(?:(?:(?:with|of)\\s+)?(?:exact(?:ly)?\\s+)?(?:dimensions?|size)(?:\\s+(?:of|is|at|to|exact(?:ly)?)){0,2}|at|of|exact(?:ly)?)?\\s*$`,
  "i",
);
const NON_PIXEL_UNIT_CONTEXT_AFTER =
  /^\s*(?:(?:mm|millimeters?|cm|centimeters?|inch(?:es)?|ft|feet|pt|points?|pc|picas?|em|rem)\b|in\b(?=\s*(?:[.;,!?)]|$))|["″'′])/i;
interface CanvasDimensionCandidate {
  rawWidth: string;
  rawHeight: string;
  width: number;
  height: number;
}

export type CanvasIntent =
  | { kind: "responsive" }
  | {
      kind: "fixed";
      source: "explicit-dimensions" | "preset" | "fixed-output";
      preset?: string;
      dimensions?: CanvasDimensions;
    };

interface CanvasPresetAlias {
  preset: string;
  pattern: RegExp;
}

const CANVAS_PRESET_ALIASES: CanvasPresetAlias[] = [
  {
    preset: "LinkedIn Cover",
    pattern: /\blinkedin\s+cover\b/i,
  },
  {
    preset: "LinkedIn Single Image Ad",
    pattern:
      /\blinkedin\b[\s\S]{0,48}\b(?:single[\s-]?image\s+)?(?:ads?|advert(?:isement)?s?|anzeige|annonce|publicit[ée]|an[uú]ncio|publicidade)\b|\b(?:ads?|advert(?:isement)?s?|anzeige|annonce|publicit[ée]|an[uú]ncio|publicidade)\b[\s\S]{0,48}\blinkedin\b/i,
  },
  {
    preset: "Meta Feed Landscape Ad",
    pattern:
      /^(?=[\s\S]*\b(?:meta|facebook)\b)(?=[\s\S]*\b(?:feed|ads?)\b)(?=[\s\S]*\b(?:landscape|horizontal|wide)\b)[\s\S]*$/i,
  },
  {
    preset: "Meta Feed Square Ad",
    pattern: /\b(?:meta|facebook)\b[\s\S]{0,32}\b(?:feed|ads?)\b/i,
  },
  {
    preset: "Instagram Story",
    pattern:
      /\binstagram\b[\s\S]{0,24}\bstor(?:y|ies)\b|\bstor(?:y|ies)\b[\s\S]{0,24}\binstagram\b/i,
  },
  {
    preset: "Instagram Post",
    pattern:
      /\bsquare\s+instagram\s+posts?\b|\binstagram\b[\s\S]{0,24}\bsquare\b[\s\S]{0,12}\bposts?\b|\binstagram\b[\s\S]{0,24}\bposts?\s+in\s+(?:a\s+)?square(?:\s+format)?\b/i,
  },
  {
    preset: "Instagram Portrait Post",
    pattern:
      /\binstagram\b[\s\S]{0,24}\b(?:feed\s+)?posts?\b|\b(?:feed\s+)?posts?\b[\s\S]{0,24}\binstagram\b/i,
  },
  {
    preset: "Open Graph Image",
    pattern: /\b(?:open\s+graph|og)\s+(?:preview\s+)?image\b|\bog\s+image\b/i,
  },
  {
    preset: "YouTube Thumbnail",
    pattern:
      /\byou\s*tube\b[\s\S]{0,24}\bthumbnail\b|\bthumbnail\b[\s\S]{0,24}\byou\s*tube\b/i,
  },
  {
    preset: "X Promo Graphic",
    pattern:
      /\b(?:twitter|x)\s*[/|]\s*x?\b[\s\S]{0,32}\bpromo(?:tional)?\s+(?:graphic|image|post)\b|\b(?:twitter|x)\b[\s\S]{0,32}\bpromo(?:tional)?\s+(?:graphic|image|post)\b/i,
  },
  {
    preset: "Mobile Leaderboard",
    pattern: /\bmobile\s+leaderboard\b/i,
  },
  {
    preset: "Leaderboard",
    pattern: /\b(?:display\s+)?leaderboard\b/i,
  },
  {
    preset: "Medium Rectangle",
    pattern: /\bmedium\s+rectangle\b|\bdisplay\s+ads?\b/i,
  },
  {
    preset: "Email Header",
    pattern: /\b(?:email|newsletter)\s+headers?\b/i,
  },
];

const OUTPUT_VERB =
  /\b(?:create|make|design|generate|build|produce|draft|render|draw|prepare|compose|crea(?:r)?|diseñ(?:a|ar)|disegna(?:re)?|erstelle|erstellen|gestalte(?:n)?|crée(?:z|r)?|concevoir|produire|dessiner|faire)\b/i;
const OUTPUT_RELATION_BOUNDARY =
  /\b(?:for|with|using|including|featuring|showing|based\s+on|inspired\s+by|announcing|promoting|about|on|that|which)\b/i;
const PRODUCT_SURFACE_OUTPUT =
  /\b(?:(?:[\w-]+\s+){0,5}(?:tools?|editors?|makers?|generators?|builders?|creators?)|dashboard|dashboards|manager|management\s+(?:tool|app|platform)|(?:web|mobile|desktop)\s+apps?|applications?|website|web\s+site|landing\s+page|pricing\s+page|settings\s+page|login\s+screen|web\s+page|product\s+interface|portal|platform|crm|workspace|admin\s+(?:panel|dashboard)|prototype|site|form)\b/i;
const FIXED_ARTWORK_OUTPUT =
  /\b(?:ads?|advertisements?|banners?|leaderboards?|skyscrapers?|billboards?|anzeige(?:n)?|annonce(?:s)?|publicit[ée]|an[uú]ncio(?:s)?|publicidade|social(?:\s+media)?\s+(?:posts?|stor(?:y|ies))|instagram\s+(?:posts?|stor(?:y|ies))|email\s+headers?|newsletter\s+(?:headers?|graphics?)|flyers?|posters?|brochures?|infographics?|cover\s+art|favicons?|logos?|avatars?|thumbnails?|promo(?:tional)?\s+(?:graphics?|images?|posts?)|open\s+graph\s+(?:preview\s+)?images?|og\s+images?)\b/i;

function requestedOutputPhrase(prompt: string): string {
  const verb = OUTPUT_VERB.exec(prompt);
  const remainder = verb ? prompt.slice(verb.index + verb[0].length) : prompt;
  const sentence = remainder.split(/[.!?;\n]/, 1)[0] ?? remainder;
  const relation = OUTPUT_RELATION_BOUNDARY.exec(sentence);
  const phrase = sentence.slice(0, relation?.index ?? sentence.length).trim();
  if (relation && /^(?:for|on)$/i.test(relation[0])) {
    const platform = sentence
      .slice(relation.index + relation[0].length)
      .match(
        /^\s+(?:(?:an?|the)\s+)?(linkedin|meta|facebook|instagram|twitter|x|youtube|google)\b/i,
      );
    if (platform) return `${phrase} ${platform[1]}`;
  }
  return phrase;
}

function presetDimensions(name: string): CanvasDimensions | undefined {
  const preset = allFrameSizePresets().find(
    (candidate) => candidate.name === name,
  );
  return preset ? { width: preset.width, height: preset.height } : undefined;
}

export function resolveCanvasIntent(prompt?: string): CanvasIntent {
  const value = prompt?.trim();
  if (!value) return { kind: "responsive" };

  const exactDimensions = explicitCanvasDimensionsFromPrompt(value);
  if (exactDimensions) {
    return {
      kind: "fixed",
      source: "explicit-dimensions",
      dimensions: exactDimensions,
    };
  }

  const output = requestedOutputPhrase(value);
  if (PRODUCT_SURFACE_OUTPUT.test(output)) return { kind: "responsive" };

  const outputAlias = CANVAS_PRESET_ALIASES.find((alias) =>
    alias.pattern.test(output),
  );
  if (outputAlias) {
    const alias = outputAlias;
    const dimensions = presetDimensions(alias.preset);
    if (dimensions) {
      return {
        kind: "fixed",
        source: "preset",
        preset: alias.preset,
        dimensions,
      };
    }
  }

  if (FIXED_ARTWORK_OUTPUT.test(output)) {
    return { kind: "fixed", source: "fixed-output" };
  }

  const contextualAlias = CANVAS_PRESET_ALIASES.find((alias) =>
    alias.pattern.test(value),
  );
  if (contextualAlias) {
    const dimensions = presetDimensions(contextualAlias.preset);
    if (dimensions) {
      return {
        kind: "fixed",
        source: "preset",
        preset: contextualAlias.preset,
        dimensions,
      };
    }
  }

  return { kind: "responsive" };
}

export function explicitCanvasDimensionsFromPrompt(
  prompt?: string,
): CanvasDimensions | undefined {
  if (!prompt) return undefined;

  const matches = Array.from(prompt.matchAll(DIMENSION_PAIR));
  const explicitDimensionsByKey = new Map<string, CanvasDimensionCandidate>();
  const formatDimensionsByKey = new Map<string, CanvasDimensionCandidate>();
  const imageDimensionsByKey = new Map<string, CanvasDimensionCandidate>();
  const outputDimensionsByKey = new Map<string, CanvasDimensionCandidate>();

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const rawWidth = match[1] ?? "";
    const rawHeight = match[3] ?? "";
    const width = Number(rawWidth.replace(/,/g, ""));
    const height = Number(rawHeight.replace(/,/g, ""));

    const start = match.index ?? 0;
    const end = start + match[0].length;
    const previousEnd =
      index > 0
        ? (matches[index - 1]!.index ?? 0) + matches[index - 1]![0].length
        : 0;
    const nextStart = matches[index + 1]?.index ?? prompt.length;
    const prefixParts = prompt
      .slice(Math.max(previousEnd, start - 48), start)
      .split(/[,;.!?\n]/);
    const prefix = prefixParts[prefixParts.length - 1];
    const nearbyPrefix = prompt.slice(Math.max(0, start - 96), start);
    const suffix = prompt
      .slice(end, Math.min(nextStart, end + 48))
      .split(/[,;.!?\n]/)[0];
    if (
      LAYOUT_COUNT_CONTEXT_AFTER.test(suffix ?? "") ||
      ASPECT_RATIO_CONTEXT_BEFORE.test(prefix ?? "") ||
      ASPECT_RATIO_CONTEXT_AFTER.test(suffix ?? "") ||
      NON_PIXEL_UNIT_CONTEXT_AFTER.test(suffix ?? "")
    ) {
      continue;
    }
    const hasDimensionContext =
      DIMENSION_CONTEXT_BEFORE.test(prefix ?? "") ||
      DIMENSION_CONTEXT_AFTER.test(suffix ?? "") ||
      OUTPUT_LAYOUT_AT_SIZE_CONTEXT_BEFORE.test(prefix ?? "") ||
      OUTPUT_CONTEXT_BEFORE_SEPARATOR.test(nearbyPrefix);
    const hasPixelImageContext =
      Boolean(match[2] || match[4]) &&
      PIXEL_ASSET_CONTEXT_AFTER.test(suffix ?? "");
    const hasFormatContext =
      FORMAT_CONTEXT_BEFORE.test(prefix ?? "") ||
      FORMAT_CONTEXT_BEFORE.test(nearbyPrefix) ||
      FORMAT_CONTEXT_AFTER.test(suffix ?? "") ||
      OUTPUT_FORMAT_CONTEXT_BEFORE_AT.test(nearbyPrefix);
    const hasNestedAssetContext =
      NESTED_OUTPUT_ASSET_CONTEXT_BEFORE.test(nearbyPrefix) ||
      NESTED_ASSET_FOR_OUTPUT_AFTER.test(suffix ?? "") ||
      ((NESTED_OUTPUT_RELATIONSHIP_BEFORE.test(nearbyPrefix) ||
        NESTED_PAGE_RELATIONSHIP_BEFORE.test(nearbyPrefix) ||
        NESTED_SCREEN_SIBLING_RELATIONSHIP_BEFORE.test(nearbyPrefix)) &&
        NESTED_OUTPUT_ASSET_AFTER.test(suffix ?? "") &&
        !EXPLICIT_CANVAS_DIMENSION_CONTEXT_BEFORE.test(prefix ?? ""));
    const hasImageOutputContext =
      IMAGE_OUTPUT_CONTEXT_BEFORE.test(prefix ?? "") ||
      (ASSET_CONTEXT_AFTER.test(suffix ?? "") && width >= 100 && height >= 100);

    if (hasNestedAssetContext) continue;
    if (
      !hasDimensionContext &&
      !hasImageOutputContext &&
      !hasPixelImageContext &&
      !hasFormatContext
    ) {
      continue;
    }

    const hasPixelUnit = Boolean(match[2] || match[4]);
    const hasDirectDimensionContext =
      DIMENSION_CONTEXT_BEFORE.test(prefix ?? "") ||
      DIMENSION_CONTEXT_AFTER.test(suffix ?? "") ||
      EXPLICIT_CANVAS_DIMENSION_CONTEXT_BEFORE.test(prefix ?? "");
    if (
      !hasPixelUnit &&
      !hasDirectDimensionContext &&
      width < 100 &&
      height < 100
    ) {
      continue;
    }

    const candidate = { rawWidth, rawHeight, width, height };
    const target = hasDimensionContext
      ? explicitDimensionsByKey
      : hasFormatContext && !hasImageOutputContext
        ? formatDimensionsByKey
        : imageDimensionsByKey;
    const key = `${width}x${height}`;
    target.set(key, candidate);
    outputDimensionsByKey.set(key, candidate);
  }

  const dimensionsByKey =
    explicitDimensionsByKey.size > 0
      ? explicitDimensionsByKey
      : formatDimensionsByKey.size > 0
        ? formatDimensionsByKey
        : imageDimensionsByKey;
  for (const candidate of outputDimensionsByKey.values()) {
    const { rawWidth, rawHeight, width, height } = candidate;
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width > MAX_SANE_FRAME_DIMENSION_PX ||
      height > MAX_SANE_FRAME_DIMENSION_PX
    ) {
      throw new Error(
        `Exact canvas dimensions ${rawWidth}×${rawHeight} exceed the Design editor limit of ${MAX_SANE_FRAME_DIMENSION_PX} px per dimension. Choose smaller exact dimensions.`,
      );
    }
    if (width <= 0 || height <= 0) {
      throw new Error(
        `Exact canvas dimensions ${rawWidth}×${rawHeight} must be greater than zero. Choose positive exact dimensions.`,
      );
    }
    const aspectRatio = Math.max(width / height, height / width);
    if (aspectRatio > MAX_SANE_FRAME_ASPECT_RATIO) {
      throw new Error(
        `Exact canvas dimensions ${rawWidth}×${rawHeight} exceed the Design editor limit of ${MAX_SANE_FRAME_ASPECT_RATIO}:1. Choose supported exact dimensions.`,
      );
    }
  }
  if (outputDimensionsByKey.size > 1) {
    const requested = [...outputDimensionsByKey.values()]
      .map(({ width, height }) => `${width}×${height}`)
      .join(", ");
    throw new Error(
      `Found multiple exact canvas sizes (${requested}). Use one exact canvas size per Design action call, with each prompt scoped to one screen.`,
    );
  }

  const selected = dimensionsByKey.values().next().value;
  return selected
    ? { width: selected.width, height: selected.height }
    : undefined;
}
