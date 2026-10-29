import { callAction } from "@agent-native/core/client/hooks";

import type { NewDeckReferenceSelection } from "@/components/editor/NewDeckReferenceStep";
import type { UploadedFile } from "@/components/editor/PromptDialog";
import { canAddInlineImageToPayload } from "@/lib/image-drop-to-agent";
import type { ImportedSourceDeck } from "@/lib/import-uploaded-deck";
import { referenceDocumentFormat } from "@/lib/reference-document-hydration";

export const WEBSITE_STYLE_REFERENCE_DIRECTIVE =
  "When the user asks to use or match a website's styling or branding and provides a URL, call `import-from-url` for each URL before generating. Treat the returned design.md-style visual system as the source of truth for colors, typography, spacing, components, and imagery. If no URL is provided, ask for one instead of guessing the site's style from its name.";

export const NO_UPLOADED_FILES_CONTEXT =
  "No uploaded files are attached to this run. Use source text already present in the user message or supplied reference context. For a supplied URL, follow its dedicated import instructions. Never invent a local file path or call `import-file` for an unattached file. If the referenced content is not present or retrievable from a supplied reference, ask the user to upload the file or paste its contents.";

export const BLANK_AND_FOLLOW_UP_SCOPE_INSTRUCTION =
  'Scale the work to the request; this rule overrides the generation steps below. A blank or empty deck request needs no question, outline, progress run, retitle, or audit: add one empty slide with `add-slide` (layout "blank") and reply. These generation instructions govern only this generation and its guided-question answers; a later direct request in this thread, such as adding an empty slide, renaming, reordering, or deleting, is a targeted edit: make it with the one action it needs and reply.';

export const SLIDE_COUNT_COMPLETION_INSTRUCTION =
  "For a requested slide count, compare the realSlideCount returned by every add-slide result (slideCount only if realSlideCount is absent) with the persisted target; blank placeholder slides do not count. Once it matches, stop all slide writes and return a completion summary. If add-slide returns errorCode target_slide_count_reached, re-read get-deck once; if the target is already satisfied, stop without retrying and finish the response. Only add more slides if the user explicitly asks to extend the deck and targetSlideCountOverride is set to the new total of real slides.";

export const SLIDE_AUTHORING_OWNERSHIP_INSTRUCTION =
  "Slides owns authoring this deck. Use Slides actions for slide content, layout, styling, and review, guided by the linked design system and reference context already hydrated here. Keep deck generation and edits in Slides; a design-heavy brief or linked design system is not a reason to hand off slide work. Call Design only for a user-requested Design-owned input or a capability only Design provides, then return to Slides for all deck authoring.";

export function isSourceImprovementRequest(
  prompt: string,
  files: UploadedFile[],
): boolean {
  const hasSourceDeck = files.some((file) =>
    /\.(pptx|pdf)$/i.test(file.originalName),
  );
  if (!hasSourceDeck) return false;

  const normalized = prompt.toLowerCase();
  const asksToImprove =
    /\b(restyl\w*|redesign\w*|rebrand\w*|revamp\w*|rework\w*|moderni[sz]\w*|refresh\w*|polish\w*|improv\w*|updat\w*|revis\w*|edit\w*)\b/.test(
      normalized,
    ) ||
    /\bmake\b[\s\S]{0,40}\b(better|modern|professional|polished|prett\w*)\b/.test(
      normalized,
    );
  const asksToConvertSource =
    /(?:\b(turn|convert|transform|make|build|create|generate)\b[^\n.!?]{0,50}\b(into|to)\b[^\n.!?]{0,30}\b(deck|presentation|slides?)\b|\b(create|build|make|generate)\b[^\n.!?]{0,80}\b(deck|presentation|slides?)\b[^\n.!?]{0,80}\bfrom\b)/.test(
      normalized,
    );
  const explicitlyReferenceOnly =
    /\b(reference material|reference only|as a reference|for reference)\b/.test(
      normalized,
    );
  if (explicitlyReferenceOnly) return false;

  const asksToPreserveSource =
    asksToConvertSource &&
    /\b(copy|slide[- ]for[- ]slide|preserv\w*|same order|before\s*\/?\s*after|placeholder\w*|out of order)\b/.test(
      normalized,
    );
  return asksToImprove || asksToPreserveSource || asksToConvertSource;
}

export function describeUploadedFilesForAgent(
  files: UploadedFile[],
  deckId: string,
  importedSourceDeck: ImportedSourceDeck | null = null,
): string {
  if (files.length === 0) {
    return ["", NO_UPLOADED_FILES_CONTEXT].join("\n");
  }
  const hasDocumentReferences = files.some((file) =>
    referenceDocumentFormat(file),
  );
  const fileList = files
    .map(
      (file) =>
        `- ${file.originalName} (${file.type}, ${(file.size / 1024).toFixed(1)}KB) at path: ${file.path}${file.url ? `; embeddable URL: ${file.url}` : ""}`,
    )
    .join("\n");
  return [
    "",
    importedSourceDeck
      ? `The user uploaded ${files.length} file(s). The ${importedSourceDeck.file.originalName} source deck has already been imported into target deck ${deckId} with ${importedSourceDeck.slideCount} source slide(s); do not import it again.`
      : `The user attached ${files.length} file(s) as reference material for this new deck. Attachments are context for the agent by default; do not import or append their slides to target deck ${deckId} merely because they were attached.`,
    fileList,
    "",
    "File handling rules:",
    importedSourceDeck
      ? "- The imported source deck is canonical. Preserve its slide count, order, IDs, factual copy, notes, imagery, charts, tables, diagrams, and freeform objects while improving styling. For a deck-wide restyle, read the full deck once with get-deck compact=false; it returns sourceImport.slideIds, each slide's HTML and contentHash, and the linked design context. Call get-design-system once for full tokens, assets, and instructions, then use one patch-deck call with requireAllSourceSlides=true and the matching baseContentHash on every patch-slide. Verify once with get-deck using slideIds=sourceImport.slideIds and compact=false. Use update-slide only for a targeted one-slide edit. Do not rebuild it with add-slide."
      : hasDocumentReferences
        ? "- PDF, PPTX, and DOCX files were already read before this run. Their content and measured visual language are in the `Attached Reference Documents` section below, or in the reference deck they were imported into. Do not call `import-file` for them again unless the `Attached Reference Documents` section says a file was omitted for space, and never generate as if a reference were missing."
        : "- No PDF, PPTX, or DOCX reference is attached to this run; do not invent one.",
    importedSourceDeck
      ? "- For a PDF source, keep the layers the import produced — positioned text boxes and images, or the page image where a page carried nothing else — and add restrained design-system chrome around them without obscuring source content. Never replace an imported slide with a retyped approximation of its text."
      : "- Do not pass `importIntoDeck: true` for an attached file unless the user explicitly asks to import or preserve the source pages in the current deck. An attached reference is not an instruction to replace or seed the deck.",
    "- Text-like files: use the uploaded-text-file blocks already included in the prompt; do not call import-file for them.",
    '- Image files with an embeddable URL are mandatory assets: if the user specified where to use one (e.g. "on the first and last slide"), embed it there with `<img src="...">` exactly as requested. Do not omit a requested image and continue silently — if it truly cannot be placed, say why in your final chat response.',
    '- Image files without a URL are sent as inline visual/reference assets for this run when available; on a follow-up, call `import-file --filePath "<path>" --format image` to reopen a persisted private raster before visual editing, and call `upload-image` if a durable embeddable URL is needed.',
    "- When converting an attached image into a deck, inspect the complete visual source before adding slides. If it contains distinct source frames, represent them in order; do not repeatedly place the source image itself, stop after an arbitrary subset, or infer a fixed frame count.",
    importedSourceDeck
      ? "- Before your final response, verify the same source slide IDs and count with get-deck after the restyle. If source fidelity is partial or images were skipped, report the exact warning instead of claiming success."
      : "- Before your final response, verify every uploaded file above was either used as reference or placed as explicitly requested. If any file's content or requested placement is missing from the deck, say so explicitly instead of reporting success.",
  ].join("\n");
}

export interface UploadedImageAgentOptions {
  referenceImagePaths?: string[];
  images?: string[];
}

export function getUploadedImageAgentOptions(
  files: UploadedFile[],
): UploadedImageAgentOptions {
  const referenceImagePaths: string[] = [];
  const images: string[] = [];

  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    if (file.url) referenceImagePaths.push(file.url);
    if (file.dataUrl && canAddInlineImageToPayload(images, file.dataUrl)) {
      images.push(file.dataUrl);
    }
  }

  return {
    ...(referenceImagePaths.length > 0 ? { referenceImagePaths } : {}),
    ...(images.length > 0 ? { images } : {}),
  };
}

export interface DeckGenerationContext {
  originalPrompt: string;
  additionalContext?: string;
  files: Array<{
    path: string;
    url?: string;
    originalName: string;
    type: string;
  }>;
  designSystemId: string | null;
  referenceDeckId: string | null;
  referenceSource?: NewDeckReferenceSelection["referenceSource"];
  composerContext?: NewDeckReferenceSelection["composerContext"];
  contextItems?: NewDeckReferenceSelection["contextItems"];
  mode: "new" | "source-preserving";
  targetSlideCount?: number;
  generationAttemptId?: string;
  generationStartedAt?: number;
}

export async function persistDeckGenerationContext(
  deckId: string,
  context: DeckGenerationContext,
): Promise<void> {
  await callAction("patch-deck", {
    deckId,
    operations: [
      {
        op: "patch-deck-fields",
        fields: {
          generationContext: context as unknown as Record<string, unknown>,
        },
      },
    ],
  });
}

const NUMBER_WORDS =
  "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split(
    " ",
  );
// Only one..twenty are counts; the larger words are matched so they can veto.
const NUMBER = `${NUMBER_WORDS.join("|")}|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|dozen|couple|few|several|twice|double|triple|half|pair`;
const CORE = "deck|presentation|pitch|slideshow|keynote|talk|powerpoint|ppt";
const DECK = `${CORE}|summary|overview|explainer|proposal|report|briefing|update|demo|guide|tutorial|training|workshop|course|lesson|intro|introduction|plan|roadmap|strategy|recap|template|walkthrough|review|story|infographic|carousel|whitepaper|study|handout|primer|brief`;
const BOUNDS =
  "at most|at least|up to|than|under|over|fewer|less|more|min|max|minimum|maximum|most|least|tops|limit|cap|ceiling|budget|around|approximately|roughly|nearly|almost|circa|top|first|last|next|another|additional|as many|as few|minus|excluded";
// A revision anywhere in the prompt withdraws the count.
const REVISION =
  "actually|instead|scratch that|on second thought|never mind|correction|change (?:it )?to|cut (?:it )?(?:down )?to|let's say|let’s say|works better|is better|too long|too short|disagree|cancel|disregard|update";
const DRIFT = "maybe|perhaps|bump|raise|increase|reduce|trim|shrink|lower";
// Words that make a count provisional, flexible, or additive.
const SOFT =
  "flexible|suggestion|guideline|judgment|exceed|separate|appendix|excluding|not counting|not including|besides|beyond|bonus|extra|in addition|on top|feel free|add more|more if|as needed|as necessary|if needed|if necessary|count|length|longer|shorter|then|followed|plus|later|initially|for now|starting|start|begin|now|extend|expand|revisit|iterate|revise|after|optional|stretch|backups?|hidden|if|unless|ideally|preferably|approximate|ballpark|estimate|guidelines|suggestions|give or take|aim|might|rough|tbd|open to|bigger|go over|unresolved";
// "N slides", "N-slide", "N more slides". Every separator is a single bounded
// run: a flood of whitespace has nothing to backtrack over.
const MENTION = new RegExp(
  `\\b(\\d+|${NUMBER})(?:[ –-]{1,3}([a-z]+))?[ –-]{0,3}slide(s?)\\b`,
  "gi",
);
const OTHER_NUMBER = new RegExp(`\\b(?:\\d{1,2}|${NUMBER})\\b`, "i");
// "Slide 3" and a "1." list marker name a slide inside the deck; only a number
// past the count contradicts it.
const SLIDE_REF =
  /\bslides? (\d{1,2})(?: ?[-–] ?(\d{1,2}))?\b|\n ?(?:[-*•] )?(\d{1,2})[.)] /gi;
const VERB =
  /\b(?:create|make|build|generate|produce|draft|design|write|prepare|put together|crie|want|need|give|compose|craft|assemble|develop)\b/i;
// An imperative that opens its own sentence or line is a separate ask; two of
// them mean the count may size something other than the deck.
const ASK_OPENER =
  /^(?:(?:\d{1,2}[.)]|[-*•>]|please|also|then|now|and)\s+)*(?:create|make|build|generate|produce|draft|design|write|prepare|put together|crie|compose|craft|assemble|develop)\b/i;
// A question, a hypothetical, someone else's or a cancelled task, a quoted UI
// label, or a label/product number ("Windows 11", "Day 2") is not a deck-size ask.
const FRAME =
  "how|why|what|suppose|imagine|hypothetically|cannot|unable|impossible|cancel|ignore|disregard|forget|scrap|drop|skip|remind|ask|tell|schedule|probably|likely|optionally|guess|limited|capped|restricted|confined|held|kept|close|comparable|equivalent|related|relative|compared|according|akin|proportional|alternatively|option|worst|earlier|asked|wrote|said|told|day|week|phase|chapter|module|lesson|grade|round|level|stage|tier|step|part|section|version|release|season|episode|unit|page|figure|item|track|pod|call|called|named|titled|title|rename|label|button|chip";
// Before the count: negation, a reference to another deck, a bound or a hedge,
// or a frame that scopes the request to part of the deck ("For the intro,").
const BEFORE = new RegExp(
  `\\b(?:\\w+n['’]t|do not|never|avoid|except|but|not|like|similar|based|modell?ed|style of|better|shorter|half|my|our|your|their|his|her|its|this|that|these|those|existing|attached|current|source|previous|typical|competitor|per|each|every|apiece|keep|stick|restrict|confine|cut|within|try|aim|ideally|preferably|hopefully|possibly|should|whether|might|may|usually|normally|typically|often|always|generally|sometimes|yesterday|ago|already|tried|had|did|was|were|refuse|hate|stop|quit|${FRAME}|${BOUNDS}|${REVISION}|${DRIFT}|${SOFT})\\b|~|(?<!\\blet)['’]s\\b|^(?:for|in|on|under|at|during|across|inside|throughout|regarding|as|when|once|while|until|before|since|because|given)\\b`,
  "i",
);
const REVISED = new RegExp(`\\b(?:${REVISION}|make (?:that|it))\\b`, "i");
// Words in the request's own paragraph that bound or extend the count: a bound
// or hedge word, "add a closing slide", or a sentence that continues the
// request ("And a Q&A.").
const INSTRUCTION_WORDS = new RegExp(
  `\\b(?:${REVISION}|${DRIFT}|${BOUNDS}|${SOFT})\\b|\\badd\\b[^.!?\\n]{0,30}\\bslides?\\b|[.!?\\n] ?(?:and|also|with|along|together|as well|aside|apart|except|without|other than|bar)\\b`,
  "i",
);
const AFTER = new RegExp(
  `\\b(?:${REVISION}|${DRIFT}|${BOUNDS}|${SOFT}|or|though|but|rather|and|with|rest|remaining|others|per|each|every|long|total|minutes|hours|pages|words|depending|needed|necessary|possible|preferably|ideally)\\b|-ish|~`,
  "i",
);
// "Create 10 slides": the count follows the verb directly.
const DIRECT =
  /^(?: (?:me|us|it|a|an|exactly|precisely|just|only|some|new|short|quick|brief)){0,3} $/i;
// "Create a deck about X with 10 slides": a deck, a topic, then a connector.
const DECK_OBJECT = new RegExp(`^ (?:\\S+ ){0,2}(?:(?:${DECK})\\b ?)+`, "i");
// "of" only reaches the count from a deck: "a summary of 10 slides" is about
// slides that already exist.
const CONNECTOR =
  /(?: (?:with|in|to)|\b(?:deck|presentation|pitch|slideshow|keynote|powerpoint|ppt) (?:of|de))(?: (?:exactly|precisely|just|only|a total of|an?))* $/i;
// A document named after the deck ("a deck from a PDF with 40 slides") may be
// the one that has the slides.
const DOCUMENT = new RegExp(
  `\\b(?:${DECK}|docs?|document|pdf|file|notes|article|paper|book|site|website|page|spreadsheet|sheet|transcript|email|thread|video|recording)\\b`,
  "i",
);
const SOURCE_WORDS =
  /\b(?:from|out|using|based|into|via|per|following|matching|mirroring|copying|reusing|resembling)\b/i;
const CLEAN_TAIL = /^[ ,;:).!?]*(?:please)?[ ,;:).!?]*$/i;
// The app's own pt-BR chip: "Crie um pitch de 10 slides a partir deste doc".
const SOURCE_TAIL =
  /^ (?:from|a partir) (?:this|these|deste|desta|este|esta) (?:doc|document|file|pdf|report|notes)$/i;
// "a 10-slide deck": up to two modifiers, then the noun, which must end the
// phrase: "a 10-slide deck review" reviews a deck. A preposition or a
// conjunction is never a modifier, before the count or after it.
const NOT_MODIFIER =
  "the|for|about|on|of|from|with|in|to|into|at|by|as|that|who|which|and|or|so|if|when|where|plus|vs|no";
const PHRASE_END =
  "(?= (?:for|about|on|of|from|to|in|at|by|that|which|who|where|using|based|aimed|designed|built|focused|targeted)\\b| \\w+ing\\b|[,;:!?()]|$)";
const COMPOUND = new RegExp(
  `^(?: (?!(?:${NOT_MODIFIER}|${CORE})\\b)[^\\s,;:!?()]+){0,2} (?:${DECK})(?: (?:${CORE}))*\\b${PHRASE_END}`,
  "i",
);
const COMPOUND_WINDOW = new RegExp(
  `^(?: (?!(?:${NOT_MODIFIER})\\b)[\\w'’&-]+){0,3} $`,
  "i",
);

// Only a short prompt is read at all: past a few sentences the ask is wrapped
// in context, caveats, pasted source or later revisions that no word list
// reads reliably, and a long brief is where the wrong counts came from.
const MAX_REQUEST_CHARS = 500;
// "a 10-slide deck": the word before the count is a plain lowercase word, not a
// label or product ("Windows 11 slide", "Day 2 slide", "iPhone 16 slide").
const PLAIN_LAST_WORD = /(?:^| )[a-z]+(?:['’-][a-z]+)* $|^ $/;

function numberValue(token: string): number {
  const word = token.toLowerCase();
  if (/^\d/.test(word)) return /^[1-9]\d?$/.test(word) ? Number(word) : 0;
  return NUMBER_WORDS.indexOf(word) + 1;
}

// The result is persisted as the deck's enforced slide target: a wrong one ends
// a healthy run, while no target only skips the completion gate. So only the
// opening sentence can size the deck, and only as one unhedged "create ... N
// slides" ask. Widen what it rejects by adding words to the lists above, not
// branches here.
export function requestedSlideCount(prompt: string): number | undefined {
  if (prompt.length > MAX_REQUEST_CHARS * 2) return undefined;
  const text = (/[a-z]/.test(prompt) ? prompt : prompt.toLowerCase())
    // Soft hyphens and zero-width characters from pasted PDFs split words.
    .replace(/[\u00ad\u200b-\u200d\ufeff]/g, "")
    .replace(/[^\S\n]+/g, " ")
    .trim()
    .replace(/^(?:#{1,6}|[-*•>]|\d{1,2}[.)]) /, "")
    // "on one slide" places content; it neither sizes the deck nor clashes.
    .replace(/ ?\b(?:on|in|onto|to|per|each) (?:1|one) slide\b/gi, "");
  if (text.length > MAX_REQUEST_CHARS) return undefined;
  if (
    text.split(/[.!?\n]+/).filter((part) => ASK_OPENER.test(part.trim()))
      .length > 1
  ) {
    return undefined;
  }
  const mentions = [...text.matchAll(MENTION)];
  if (mentions.length !== 1) return undefined;
  const [m] = mentions;
  const value = numberValue(m[1]);
  const end = text.search(/[.!?](?=[ \n]|$)|\n/);
  const sentence = end === -1 ? text : text.slice(0, end);
  const verb = VERB.exec(sentence);
  const countEnd = m.index + m[0].length;
  if (
    m[2] ||
    value === 0 ||
    sentence.length > 600 ||
    countEnd > sentence.length ||
    !verb ||
    verb.index + verb[0].length > m.index
  ) {
    return undefined;
  }
  const before = sentence.slice(0, m.index);
  const window = before.slice(verb.index + verb[0].length);
  const rest = sentence.slice(countEnd);
  const later = text
    .slice(countEnd)
    .replace(SLIDE_REF, (_, a, b, c) =>
      Math.max(Number(a ?? 0), Number(b ?? 0), Number(c ?? 0)) <= value
        ? " "
        : " 99 ",
    );
  if (
    window.trim().split(" ").length > 8 ||
    OTHER_NUMBER.test(before) ||
    SOURCE_WORDS.test(window) ||
    BEFORE.test(before) ||
    REVISED.test(later) ||
    INSTRUCTION_WORDS.test(later) ||
    OTHER_NUMBER.test(later)
  ) {
    return undefined;
  }
  const object = DECK_OBJECT.exec(window);
  const sizesDeck =
    m[3] !== ""
      ? (DIRECT.test(window) ||
          (object !== null &&
            CONNECTOR.test(window) &&
            !DOCUMENT.test(window.slice(object[0].length)))) &&
        (CLEAN_TAIL.test(rest) || SOURCE_TAIL.test(rest))
      : COMPOUND.test(rest) &&
        COMPOUND_WINDOW.test(window) &&
        PLAIN_LAST_WORD.test(window) &&
        !AFTER.test(rest);
  return sizesDeck ? value : undefined;
}
