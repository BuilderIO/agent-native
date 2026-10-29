import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(),
}));

import {
  describeUploadedFilesForAgent,
  getUploadedImageAgentOptions,
  isSourceImprovementRequest,
  requestedSlideCount,
} from "./create-deck-generation";

describe("describeUploadedFilesForAgent", () => {
  it("uses supplied source context and blocks guessed file paths without uploads", () => {
    const context = describeUploadedFilesForAgent([], "deck-id");

    expect(context).toContain("No uploaded files are attached to this run");
    expect(context).toContain("Use source text already present");
    expect(context).toContain("Never invent a local file path");
    expect(context).toContain(
      "ask the user to upload the file or paste its contents",
    );
  });
});

describe("getUploadedImageAgentOptions", () => {
  it("does not forward oversized inline image data", () => {
    const oversizedDataUrl = `data:image/png;base64,${"a".repeat(1_000_000)}`;
    expect(
      getUploadedImageAgentOptions([
        {
          path: "/uploads/large.png",
          url: "https://cdn.example.test/large.png",
          originalName: "large.png",
          filename: "large.png",
          type: "image/png",
          size: 750_000,
          dataUrl: oversizedDataUrl,
        },
      ]),
    ).toEqual({
      referenceImagePaths: ["https://cdn.example.test/large.png"],
    });
  });

  it("caps the aggregate inline image payload while retaining every URL", () => {
    const dataUrls = Array.from(
      { length: 4 },
      (_, index) =>
        `data:image/png;base64,${String.fromCharCode(97 + index).repeat(800_000)}`,
    );
    const options = getUploadedImageAgentOptions(
      dataUrls.map((dataUrl, index) => ({
        path: `/uploads/image-${index}.png`,
        url: `https://cdn.example.test/image-${index}.png`,
        originalName: `image-${index}.png`,
        filename: `image-${index}.png`,
        type: "image/png",
        size: 600_000,
        dataUrl,
      })),
    );

    expect(options.referenceImagePaths).toHaveLength(4);
    expect(options.images).toHaveLength(3);
    expect(options.images).toEqual(dataUrls.slice(0, 3));
  });
});

// oracle-change: startDeckGeneration was never called by the app and had drifted from Index's real flow; it and its tests are deleted.
// oracle-change(templates/slides/app/components/editor/HomeQuickStartDialog.test.tsx): HomeQuickStartDialog had no importers and is deleted with its test.
describe("requestedSlideCount", () => {
  it.each([
    // The request's own verb reaches an "N-slide <deck noun>"
    ["Create a 10-slide deck about our Q3 results", 10],
    ["Make a 12 slide pitch", 12],
    ["I want a 7-slide presentation on climate change", 7],
    ["Create a dark 6-slide presentation", 6],
    ["Make me a 12 slide pitch deck for investors", 12],
    ["Build a twelve-slide deck", 12],
    ["Can you make me a 9-slide deck on AI safety?", 9],
    ["Please create a 6 slide deck on cybersecurity", 6],
    ["Give me a 10-slide deck on productivity", 10],
    ["Create a 3-slide keynote", 3],
    ["Create a 5-slide executive summary", 5],
    ["Create a 10-slide deck about dogs: intro, history, breeds", 10],
    ["Create a 10-slide deck, minimal text", 10],
    ["Create a 10-slide deck about Q3. Use a dark theme.\nAudience: execs", 10],
    // The count follows the verb, or the topic comes first and a connector
    // reaches the count
    ["Create 10 slides", 10],
    ["Create exactly 8 slides", 8],
    ["Make it ten slides", 10],
    ["Create a deck of 12 slides", 12],
    ["Create a deck with 8 slides", 8],
    ["Make a presentation with 10 slides", 10],
    ["Create a presentation about renewable energy with 10 slides", 10],
    ["Create a pitch deck for a startup with 10 slides", 10],
    ["Create a deck about dogs in 10 slides", 10],
    ["Create a deck with a total of 10 slides", 10],
    ["Create a deck for Q3 with exactly 10 slides, please", 10],
    // Later text that only names or places slides inside the count
    ["Create a 10-slide deck about Q3. Put the agenda on one slide.", 10],
    [
      "Create a 10-slide deck about Q3. Slide 1 is the title, slides 2-3 cover the problem.",
      10,
    ],
    ["Create a 10-slide deck about Q3:\n1. Intro\n2. Problem\n3. Solution", 10],
    // Markers, case, and the spacing a pasted prompt carries
    ["## Create a 10-slide deck about dogs", 10],
    ["- Create a 10-slide deck about dogs", 10],
    ["CREATE A 10-SLIDE DECK", 10],
    ["Create a deck with 10 slides", 10],
    ["Create a 10–slide deck", 10],
    ["Create a deck with 10 slides.\nUse charts", 10],
    // The app's own suggestion chips
    ["Build a 10-slide pitch from this doc", 10],
    ["Crie um pitch de 10 slides a partir deste doc", 10],
  ])("reads %j as a deck of %i slides", (prompt, count) => {
    expect(requestedSlideCount(prompt)).toBe(count);
  });

  it.each([
    "Create a deck about launches",
    // Bounds and ranges
    "Create SIX slides maximum",
    "Create at least 10 slides",
    "Create approximately 12 slides",
    "Create up to 8 slides",
    "Create three or four slides",
    "Create three to five slides",
    "Create between 5 and 7 slides",
    "Create 5, 6, or 7 slides",
    "Create under 10 slides",
    "Create fewer than 8 slides",
    "Create not more than 10 slides",
    "Create more than 10 slides",
    "Create over 10 slides",
    "Create 10 slides or more",
    "Create 10 slides minimum",
    "Create 10 slides max",
    "Create 10 slides tops",
    "a 5-7 slides overview",
    "Create 10-12 slide deck",
    "Create a deck with 8 slides (max 12)",
    "Create 6 slides ~ or so",
    "Create 8 slides or so",
    // Labels, ordinals, allocations, and references to existing slides
    "Pod 1 / Pod 2 slide",
    "Chapter 3 slide excerpts",
    "Cover #4 slide first",
    "Stage 2 slides",
    "Option 2 slide",
    "Page 4 slides",
    "Tier 2-4 slides",
    "Module 3 slides",
    "Lesson 2 slides",
    "Version 2 slides",
    "Topic 3 slides",
    "Level 2 slides",
    "Put the agenda on one slide",
    "Keep each concept to one slide",
    "Include 2 slides on pricing",
    "Cover each of the 6 areas with 2 slides",
    "Create a 10 minute talk with 1 slide per minute",
    "one slide per pod",
    "3 slides per section",
    "Create a deck with 3 slides per section",
    "Create a deck with 3 slides for each pod",
    "Create a deck. Q3 results: 3 slides, Q4 plan: 3 slides",
    "Create a deck with 3 slides on pricing and 2 slides on roadmap",
    "Make 6 slides, one slide per pod",
    "Copy the look of the two slides in the attached deck",
    "Use the style of the 3 slides I attached",
    "Make the 3 slides pop",
    "Summarize my 30-slide deck",
    "Update the attached 30-slide deck",
    // Decimals and numbers split from their noun
    "Section 2.1 slides",
    "Create a deck at a pace of 1.5 slides per minute",
    "Make me a deck.\n3\nSlides about pricing",
    // A bound or range that follows the form
    "Create 10 slides total or fewer",
    "Create a deck. 10 slides in total, max.",
    "Create a 10-slide deck max",
    "Create 10 slides, no more than 12",
    "Create 10 slides (or 12 if needed)",
    // Not a size for the whole deck
    "Put the agenda on 1 slide in the deck",
    "Make one slide for the presentation",
    "Include a 2-slide overview of the market",
    "Add a 1-slide summary to my deck",
    "Each pod gets 2 slides total",
    "For each pod, create 3 slides",
    "Create a deck for each pod. 2 slides total per pod",
    "Create a one hundred and twenty slide deck",
    // More than one slide-count mention, whatever its form
    "Create a 10-slide deck about Q3. Create a 6-slide deck about Q4.",
    "Make 6 slides. Six slides is plenty.",
    "Create 3 slides on pricing. Also, 2 slides on roadmap.",
    "Create 6 slides. See the Pod 2 slide for style.",
    // A sub-request after the request that opened the prompt
    "Create a pitch deck for my startup, an AI note-taking app. Make 3 slides about the market opportunity.",
    "I'm presenting to the board on Friday about Q3. Write 4 slides on revenue.",
    "Create a deck on climate change. Generate 3 slides on mitigation.",
    "Create a sales deck for Acme. Draft 2 slides on pricing tiers.",
    "Create a deck about our Q3 results. Make a 2-slide summary of the financials",
    "Create a deck for the offsite. Make a 5-slide deck on culture.",
    "Create a deck for the offsite with a 2-slide appendix",
    // A model for the deck, or a count that is denied
    "Create a pitch deck for my startup like Airbnb's famous 12-slide pitch deck",
    "Create a deck similar to Apple's 20-slide keynote",
    "Make a deck modeled on a 12-slide Sequoia pitch deck",
    "Create a deck based on a 10-slide deck I found online",
    "Don't make 10 slides, make 5",
    "Don't create a 10-slide deck, make it shorter",
    // A bound, a first pass, or slides beyond the count
    "Keep it to 10 slides",
    "Create a deck with 10 slides, 12 max",
    "Create a 10-slide deck, maximum impact",
    "Create a deck of 8 slides, but add more if needed",
    "Create 8 slides, 2 for intro and 6 for the body",
    "Create a deck with 10 slides and an appendix",
    "Create a deck with 5 slides on pricing, 3 on roadmap",
    "Create a 10-slide deck and add 3 more slides about pricing",
    "Create 3 more slides",
    "Create the first 3 slides",
    "Make a top 5 slide deck",
    "Create a deck about dogs and keep it to 10 slides",
    // Several decks: the count may be per deck or for all of them
    "Create two decks about dogs and cats, 10 slides total",
    "Create a deck about dogs and a deck about cats with 10 slides",
    // Slides that are the subject of an edit or a rate
    "Make 3 slides pop",
    "Create a deck with 3 slides a week",
    "Make a deck out of 12 slides worth of notes",
  ])("persists no target for %j", (prompt) => {
    expect(requestedSlideCount(prompt)).toBeUndefined();
  });

  it.each([
    // Key/value labels, units, ranges, and alternatives never size the deck
    "Create a deck. Deck length: 20 minutes",
    "Create a deck. Deck length: 1 hour",
    "Create a deck about X. Slide count: 8 to 10",
    "Create a deck about X. Slide count: 10; 12 if needed",
    "Create a deck about X. Slide count: 10 (12 if needed)",
    "Create a deck about X. Current slide count: 12",
    "Summarize my deck (slide count: 40) into a short one-pager deck",
    "Create a deck about X. Source deck length: 40",
    "Create a deck. Slide count: 12.5",
    "Create a deck. Total slides: 3 of 10",
    "Topic: Dogs\nLength: 10 slides\nAudience: kids",
    // A statement about what the deck should contain is not its size
    "Create a deck about our product. The deck should include 3 slides on pricing.",
    "Create a deck about retention. It must contain 2 slides of charts.",
    "Create a deck about retention. The presentation will include 2 slides about pricing.",
    "The deck should have 3 slides on churn",
    "Create a deck that includes 3 slides about pricing",
    // A part of the deck is sized, not the deck
    "Create a deck about retention. The intro should be 2 slides long.",
    "Create a deck about retention. The Q&A section should be 3 slides total.",
    "Create a deck about retention. Keep the appendix to 3 slides total.",
    "Create a deck with 10 slides in total",
    // The rest of the deck is left open
    "Create a deck with 3 slides on pricing and the rest on the roadmap",
    "Create a deck with 3 slides on pricing, the rest on roadmap",
    "Create a deck with 3 slides on pricing plus several on roadmap",
    "Create a deck with 3 slides on pricing, then others on roadmap",
    // A deck that exists, or is to be avoided, is not the deck to create
    "I have a 30-slide deck. Create a one-page summary.",
    "Our current onboarding is a 40-slide deck. Create a shorter version.",
    "Avoid a 20-slide deck",
    "Anything but a 20-slide deck",
    "It shouldn't be a 20-slide deck",
    "Create a deck half the length of a 20-slide deck",
    "Create a deck about retention. Avoid a 20-slide deck.",
    "Create a one-page summary of a deck with 30 slides",
    "Create a deck from a PDF with 40 slides",
    "Write a 10-slide deck summary",
    "Create a 10-slide deck review",
    "Create a summary of 10 slides",
    // Limits, ceilings, and hedges
    "Create a deck with a limit of 10 slides",
    "Create a deck with a cap of 10 slides",
    "Create a deck with a ceiling of ten slides",
    "Create a deck with an upper limit of 10 slides",
    "Create a deck with a hard limit of 10 slides",
    "Create a deck with a budget of 10 slides",
    "Create a deck with 10 slides, or maybe 8",
    "Create a deck with 10 slides, preferably 8",
    "Create a deck with 10 slides, though 8 would be better",
    "Create a deck with 10 slides, 15 absolute max",
    "Create a deck with 10 slides-ish",
    "Create a 10-slide deck at maximum",
    "Create a 10-slide deck. Longer is fine.",
    "Create a 10-slide deck about Q3. Max 12.",
    // Slides added to, or left out of, the count
    "Create a deck with 8 slides and the appendix",
    "Create a deck with 8 slides then an appendix",
    "Create a deck with 8 slides, followed by an appendix",
    "Create a deck with 10 slides, not counting the title",
    "Create a 10-slide deck, excluding the title slide",
    "Create a 10-slide deck besides the title slide",
    "Create a 10-slide deck. Plus an appendix.",
    "Create a 10-slide deck. Then a Q&A slide.",
    // Slides that are source material
    "Create a deck using 12 slides of notes",
    "Create a deck using 12 slides from last year's deck",
    "Create a deck out of 12 slides",
    "Create a deck with 12 slides from last year's deck",
    // A later sentence revises the count
    "Create a 10-slide deck. Actually, make that 8.",
    "Create a 10-slide deck. On second thought, make it 8.",
    "Create a deck with 10 slides. Scratch that, 6.",
    "Create a deck of ten slides. Actually, 12.",
    "Create a deck of ten slides. Change it to twelve.",
    "Create a deck of ten slides. Bump it to a dozen.",
    "Create a 10-slide deck. Slide 11 is the appendix.",
    "Create a 10-slide deck from the doc below.\n\nQ3 review\n\nThe board asked for a 6-slide version.",
    "Create a 10-slide deck from the doc below.\n\nQ3 review\n\nActually, the board prefers a short deck.",
    // Hedges, labels and revisions in a later paragraph are read too
    "Create a 10-slide deck about onboarding.\n\nFeel free to go longer if the material needs it.",
    "Create a 10 slide deck about Q3.\n\nThat is a minimum; go bigger if it helps.",
    "Create a 10 slide deck on X.\n\nNumber of slides: 15",
    "Create a 10 slide deck on X.\n\nLet's say 12.",
    "Create a 10-slide deck from the doc below.\n\nQ3 review\n\nAcme grew revenue 18% quarter over quarter. Maybe the best result: support response time dropped.",
    // A long brief is never read, wherever the ask sits
    `Create a 10-slide deck about Q3. ${"Include the revenue trend and the main driver of churn. ".repeat(12)}`,
    // Several asks, questions, cancelled or delegated asks
    "1) Create a 10 slide deck for sales\n2) Create a deck for support",
    "Create a 10 slide deck for sales. Create a deck for support too.",
    "How do I make a good 10 slide deck?",
    "Remind me to make 10 slides",
    "I cannot create a 10 slide deck",
    "Probably make a 10 slide deck",
    // Labels and products are not sizes
    "Create a Windows 11 slide deck",
    "Create a Day 2 slide deck",
    "Create a deck called 5 Slide Summary",
    // Limits and approximations phrased with to/of
    "Create a deck limited to 10 slides",
    "Create a deck close to 10 slides",
    // Titles, outline items, and decks that are the topic
    "Create a deck: Seven slides to success",
    "Create a deck:\n1. 3 slides\n2. Risks\n3. Ask",
    "1. 3 slides",
    "Create a 10-slide deck about X and another about Y",
    "Create a workshop on writing a 12-slide deck",
    "Create a one-pager and a 12-slide deck",
    // Zero-padded, composite, and oversized numbers
    "Create a deck with 010 slides",
    "Create a twenty-five slide deck",
    "Create a deck of 100 slides",
  ])("persists no target for %j", (prompt) => {
    expect(requestedSlideCount(prompt)).toBeUndefined();
  });

  it.each([
    ["en-US", () => import("@/i18n/en-US"), 10],
    ["pt-BR", () => import("@/i18n/pt-BR"), 10],
    // No localized noun is read: no count rather than a wrong one
    ["ar-SA", () => import("@/i18n/ar-SA"), undefined],
    ["de-DE", () => import("@/i18n/de-DE"), undefined],
    ["es-ES", () => import("@/i18n/es-ES"), undefined],
    ["fr-FR", () => import("@/i18n/fr-FR"), undefined],
    ["hi-IN", () => import("@/i18n/hi-IN"), undefined],
    ["ja-JP", () => import("@/i18n/ja-JP"), undefined],
    ["ko-KR", () => import("@/i18n/ko-KR"), undefined],
    ["zh-CN", () => import("@/i18n/zh-CN"), undefined],
    ["zh-TW", () => import("@/i18n/zh-TW"), undefined],
  ] as const)("reads the %s suggestion chip", async (_locale, load, count) => {
    const { default: messages } = await load();

    expect(requestedSlideCount(messages.agent.suggestionPitch)).toBe(count);
  });

  it("persists no target for a long prompt that caps the deck and later mentions a pod slide", () => {
    const prompt = [
      "Create SIX slides maximum for the Q3 account review.",
      "Background: ".padEnd(9000, "pasted research notes. "),
      "Reuse the same visual vocabulary as the opening Pod 1 / Pod 2 slide.",
    ].join("\n");

    expect(requestedSlideCount(prompt)).toBeUndefined();
  });

  it("scans whitespace floods and a megabyte prompt in linear time", () => {
    const started = performance.now();

    // A prompt this long is never read, so each of these must also be fast.
    expect(
      requestedSlideCount(`Create a deck${" ".repeat(100_000)}with 10 slides`),
    ).toBeUndefined();
    expect(
      requestedSlideCount(`Create a deck 10${"\t".repeat(100_000)}x`),
    ).toBeUndefined();
    expect(
      requestedSlideCount(`Create a deck of 10${" ".repeat(100_000)}slides`),
    ).toBeUndefined();
    expect(
      requestedSlideCount(`${"1 - ".repeat(100_000)}slide`),
    ).toBeUndefined();
    expect(
      requestedSlideCount(
        `Create a 10-slide deck about ${"lorem ipsum dolor sit amet. ".repeat(40_000)}`,
      ),
    ).toBeUndefined();
    // Under the cap a run of separators between count and noun stays linear.
    expect(
      requestedSlideCount(`Create a deck of 10${" ".repeat(400)}slides`),
    ).toBe(10);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("isSourceImprovementRequest", () => {
  it("treats an implicit improvement prompt as source-preserving", () => {
    expect(
      isSourceImprovementRequest("Make this prettier", [
        {
          path: "/uploads/source.pptx",
          originalName: "source.pptx",
          filename: "source.pptx",
          type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          size: 1024,
        },
      ]),
    ).toBe(true);
  });

  it("treats slide-for-slide restyling requests as source-preserving", () => {
    expect(
      isSourceImprovementRequest(
        'Please turn this into a deck with our styling. Copy it slide for slide (though note I realized a couple slides are out of order) - a couple of the "after" slides are not right after their "before" slides.',
        [
          {
            path: "/uploads/source.pdf",
            originalName: "source.pdf",
            filename: "source.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
      ),
    ).toBe(true);
  });

  it("treats create-from-source requests that preserve order as source-preserving", () => {
    expect(
      isSourceImprovementRequest(
        "Create a slide deck from this PDF, preserving the same order",
        [
          {
            path: "/uploads/source.pdf",
            originalName: "source.pdf",
            filename: "source.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
      ),
    ).toBe(true);
  });

  it("defaults a plain source conversion to source-preserving", () => {
    expect(
      isSourceImprovementRequest(
        "Create deck: turn this into a deck using our branding",
        [
          {
            path: "/uploads/source.pdf",
            originalName: "source.pdf",
            filename: "source.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
      ),
    ).toBe(true);

    expect(
      isSourceImprovementRequest("Make this into a deck", [
        {
          path: "/uploads/source.pdf",
          originalName: "source.pdf",
          filename: "source.pdf",
          type: "application/pdf",
          size: 1024,
        },
      ]),
    ).toBe(true);
  });
});
