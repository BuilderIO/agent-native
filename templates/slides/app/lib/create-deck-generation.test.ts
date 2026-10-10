import { describe, expect, it, vi } from "vitest";

const mockCallAction = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => mockCallAction(...args),
  deleteClientAppState: vi.fn().mockResolvedValue(undefined),
  getBrowserTabId: () => "test-tab",
}));

vi.mock("react-dom", () => ({
  flushSync: (callback: () => void) => callback(),
}));

import {
  describeUploadedFilesForAgent,
  getUploadedImageAgentOptions,
  isSourceImprovementRequest,
  requestedSlideCount,
  startDeckGeneration,
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

describe("startDeckGeneration", () => {
  async function generateWithReferenceContext(
    referenceContext: unknown,
  ): Promise<string> {
    mockCallAction.mockReset();
    mockCallAction.mockImplementation(async (name: string) =>
      name === "get-deck-reference-context" ? referenceContext : undefined,
    );
    const deck = {
      id: "deck-reference-status",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Create an about us deck",
        files: [],
        referenceSelection: { referenceDeckId: "reference-deck-status" },
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    return agentSubmit.mock.calls[0]?.[1] as string;
  }

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

  it("correlates the generating route with its submitted chat run", async () => {
    mockCallAction.mockReset();
    mockCallAction.mockResolvedValue(undefined);
    const deck = {
      id: "deck-correlated-run",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const navigate = vi.fn();
    const agentSubmit = vi.fn();
    const createDeck = vi.fn(() => deck);

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Create a deck",
        files: [],
        designSystems: [],
        createDeck,
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate,
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    expect(createDeck).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        noDefaultSlides: true,
      }),
    );

    const route = new URL(
      String(navigate.mock.calls[0]?.[0] ?? ""),
      "https://slides.test",
    );
    const routeSubmitId = route.searchParams.get("generationSubmitId");
    expect(route.searchParams.get("generating")).toBe("1");
    expect(routeSubmitId).toBeTruthy();
    expect(agentSubmit.mock.calls[0]?.[2]?.submitMessageId).toBe(routeSubmitId);
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "For a requested slide count, compare the realSlideCount returned by every add-slide result (slideCount only if realSlideCount is absent)",
    );
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "If add-slide returns errorCode target_slide_count_reached, re-read get-deck once",
    );
  });

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

  it("keeps an ordinary attached PDF as agent reference material", async () => {
    mockCallAction.mockImplementation(async (name: string) =>
      name === "import-file"
        ? {
            format: "pdf",
            pageCount: 2,
            textPageCount: 2,
            pages: [{ pageNum: 1, text: "REFERENCE_PAGE_ONE" }],
            styleDigest: {
              pageCount: 2,
              pageWidthPt: 960,
              pageHeightPt: 540,
              orientation: "landscape",
              aspectRatio: 1.778,
              backgroundColors: [],
              typeScale: [],
              paragraphAlignments: [],
              textMarginsPt: null,
              pagesWithImages: 0,
            },
          }
        : undefined,
    );
    const deck = {
      id: "deck-1",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt:
          "Create this as a focused deck, more like the attached deck. Here's the outline. Preserve the useful before and after examples, but ignore the numbers because they do not mean slides.",
        files: [
          {
            path: "/uploads/reference.pdf",
            originalName: "reference.pdf",
            filename: "ZiVAULRxvgAN1alyiLem.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
        attachments: [
          {
            type: "file",
            name: "reference.pdf",
            contentType: "application/pdf",
            displayOnly: true,
          },
          {
            type: "file",
            name: "pasted-text-1.txt",
            contentType: "text/plain",
            displayOnly: true,
            text: "outline",
          },
        ],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    expect(deck.slides).toEqual([]);
    expect(mockCallAction).toHaveBeenCalledWith(
      "import-file",
      expect.objectContaining({
        filePath: "/uploads/reference.pdf",
        format: "pdf",
      }),
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(mockCallAction).not.toHaveBeenCalledWith(
      "import-file",
      expect.objectContaining({ importIntoDeck: true }),
      expect.anything(),
    );
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "## Attached Reference Documents",
    );
    expect(agentSubmit.mock.calls[0]?.[1]).toContain("REFERENCE_PAGE_ONE");
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "Measured visual language",
    );
    expect(agentSubmit).toHaveBeenCalledOnce();
    expect(agentSubmit.mock.calls[0]?.[0]).toBe(
      "Create this as a focused deck, more like the attached deck. Here's the outline. Preserve the useful before and after examples, but ignore the numbers because they do not mean slides.",
    );
    expect(agentSubmit.mock.calls[0]?.[0]).not.toContain("Create deck:");
    expect(agentSubmit.mock.calls[0]?.[1]).toContain("import-from-url");
    expect(agentSubmit.mock.calls[0]?.[2]?.attachments).toEqual([
      {
        type: "file",
        name: "reference.pdf",
        contentType: "application/pdf",
        displayOnly: true,
      },
      {
        type: "file",
        name: "pasted-text-1.txt",
        contentType: "text/plain",
        displayOnly: true,
        text: "outline",
      },
    ]);
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "Attachments are context for the agent by default",
    );
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "do not import or append their slides",
    );
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "write presenter-only text into each slide's `notes` field",
    );
    expect(mockCallAction).toHaveBeenCalledWith(
      "patch-deck",
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            fields: expect.objectContaining({
              generationContext: expect.objectContaining({
                originalPrompt:
                  "Create this as a focused deck, more like the attached deck. Here's the outline. Preserve the useful before and after examples, but ignore the numbers because they do not mean slides.",
                files: [
                  expect.objectContaining({ path: "/uploads/reference.pdf" }),
                ],
              }),
            }),
          }),
        ],
      }),
    );
  });

  it("passes linked design-system guidance from a selected reference deck", async () => {
    mockCallAction.mockImplementation(async (name: string) =>
      name === "get-deck-reference-context"
        ? {
            designSystemId: "ds-reference",
            linkedDesignSystemStatus: "available",
            agentContext:
              "REFERENCE_STYLE_CONTEXT\n### Linked design system (reference default)\nUse --brand-accent: #123456.",
          }
        : undefined,
    );
    const deck = {
      id: "deck-reference-style",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Create an about us deck",
        files: [],
        referenceSelection: { referenceDeckId: "reference-deck-1" },
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    const context = agentSubmit.mock.calls[0]?.[1] as string;
    expect(context).toContain("REFERENCE_STYLE_CONTEXT");
    expect(context).toContain("### Linked design system (reference default)");
    expect(context).toContain("Use --brand-accent: #123456.");
    expect(context).toContain(
      "The reference deck's readable linked design system controls tokens and slide defaults",
    );
    expect(context).not.toContain(
      "Follow its measured visual language as the styling source of truth",
    );
    expect(context).not.toContain("Before generating a bare or on-brand deck");
    expect(context).not.toContain("use a light warm-neutral canvas");
  });

  it("keeps the selected target system ahead of a reference deck's linked system", async () => {
    mockCallAction.mockImplementation(async (name: string) => {
      if (name === "get-deck-reference-context") {
        return {
          designSystemId: "ds-reference",
          linkedDesignSystemStatus: "available",
          agentContext:
            "REFERENCE_STYLE_CONTEXT\n### Linked design system (reference default)\nReference system A tokens.",
        };
      }
      if (name === "get-design-system") {
        return { agentContext: "SELECTED_TARGET_SYSTEM_B_CONTEXT" };
      }
      return undefined;
    });
    const deck = {
      id: "deck-selected-target-system",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const createDeck = vi.fn(() => deck);
    const agentSubmit = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Create an about us deck",
        files: [],
        selectedDesignSystemId: "ds-target-b",
        selectedReferenceDeckId: "reference-deck-1",
        designSystems: [],
        createDeck,
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    expect(createDeck).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ designSystemId: "ds-target-b" }),
    );
    expect(mockCallAction).toHaveBeenCalledWith(
      "get-design-system",
      { id: "ds-target-b" },
      { method: "GET" },
    );
    const context = agentSubmit.mock.calls[0]?.[1] as string;
    expect(context).toContain("SELECTED_TARGET_SYSTEM_B_CONTEXT");
    expect(context).toContain(
      "overriding reference-deck linked systems and measured reference styling",
    );
    expect(context).not.toContain(
      "The reference deck's linked design system controls tokens and slide defaults",
    );
  });

  it("uses measured reference styling when its linked system is inaccessible", async () => {
    mockCallAction.mockImplementation(async (name: string) =>
      name === "get-deck-reference-context"
        ? {
            designSystemId: "ds-private",
            linkedDesignSystemStatus: "unavailable",
            agentContext:
              "REFERENCE_STYLE_CONTEXT\n### Linked design system (unavailable)\nThe linked system could not be read.",
          }
        : undefined,
    );
    const deck = {
      id: "deck-unavailable-reference-system",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Create an about us deck",
        files: [],
        referenceSelection: { referenceDeckId: "reference-deck-private" },
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    const context = agentSubmit.mock.calls[0]?.[1] as string;
    expect(context).toContain("The linked system could not be read.");
    expect(context).toContain(
      "Because the reference deck was read successfully, use its measured visual language",
    );
    expect(context).not.toContain(
      "The reference deck's readable linked design system controls tokens and slide defaults",
    );
  });

  it.each([
    [
      "none status with an id",
      {
        designSystemId: "ds-reference",
        linkedDesignSystemStatus: "none",
      },
    ],
    [
      "available status without an id",
      { designSystemId: null, linkedDesignSystemStatus: "available" },
    ],
    [
      "unavailable status with a blank id",
      { designSystemId: "  ", linkedDesignSystemStatus: "unavailable" },
    ],
    ["missing status", { designSystemId: null }],
  ] as const)(
    "stops when linked-system status metadata is inconsistent (%s)",
    async (_case, metadata) => {
      const context = await generateWithReferenceContext({
        ...metadata,
        agentContext: "REFERENCE_STYLE_CONTEXT",
      });

      expect(context).toContain("returned incomplete linked-system status");
      expect(context).toContain(
        "stop instead of generating with an assumed style",
      );
      expect(context).not.toContain("REFERENCE_STYLE_CONTEXT");
      expect(context).not.toContain(
        "Because the reference deck was read successfully",
      );
    },
  );

  it("allows no linked system only when its status and id agree", async () => {
    const context = await generateWithReferenceContext({
      designSystemId: null,
      linkedDesignSystemStatus: "none",
      agentContext: "REFERENCE_STYLE_CONTEXT",
    });

    expect(context).toContain("REFERENCE_STYLE_CONTEXT");
    expect(context).toContain(
      "Because the reference deck was read successfully, use its measured visual language",
    );
  });

  it.each(["throws", "returns empty"] as const)(
    "does not treat a failed reference read as proof that no system is linked (%s)",
    async (readResult) => {
      mockCallAction.mockImplementation(async (name: string) => {
        if (name === "get-deck-reference-context") {
          if (readResult === "throws")
            throw new Error("Reference access denied");
          return undefined;
        }
        return undefined;
      });
      const deck = {
        id: "deck-unreadable-reference",
        title: "Untitled Deck",
        createdAt: "2026-08-11T00:00:00.000Z",
        updatedAt: "2026-08-11T00:00:00.000Z",
        slides: [],
      };
      const agentSubmit = vi.fn();

      await expect(
        startDeckGeneration({
          session: { user: "owner@example.com" },
          prompt: "Create an about us deck",
          files: [],
          referenceSelection: { referenceDeckId: "reference-deck-unreadable" },
          designSystems: [],
          createDeck: vi.fn(() => deck),
          ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
          deleteDeck: vi.fn(),
          navigate: vi.fn(),
          agentSubmit,
          onPromptClosed: vi.fn(),
          onUnauthenticated: vi.fn(),
          onPersistenceFailure: vi.fn(),
        }),
      ).resolves.toBe("started");

      const context = agentSubmit.mock.calls[0]?.[1] as string;
      expect(context).toContain(
        readResult === "throws"
          ? "could not be loaded before generation"
          : "returned no usable context",
      );
      expect(context).toContain(
        "Do not assume it has no linked system or use measured styling as a fallback",
      );
      expect(context).toContain(
        "its linked-system status and measured visual language are unknown",
      );
      expect(context).not.toContain(
        "Because the reference deck was read successfully, use its measured visual language",
      );
    },
  );

  it("keeps a reference-import file out of source-preserving mode", async () => {
    mockCallAction.mockClear();
    mockCallAction.mockResolvedValue(undefined);
    const deck = {
      id: "deck-reference-file",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Create an about us deck",
        files: [
          {
            path: "/uploads/reference.pdf",
            originalName: "reference.pdf",
            filename: "reference.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
        referenceSelection: {
          referenceDeckId: "reference-deck-1",
          referenceFilePaths: ["/uploads/reference.pdf"],
          importedReferenceFilePath: "/uploads/reference.pdf",
        },
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    expect(mockCallAction).not.toHaveBeenCalledWith(
      "import-file",
      expect.anything(),
      expect.anything(),
    );
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "Attachments are context for the agent by default",
    );
    expect(agentSubmit.mock.calls[0]?.[1]).not.toContain(
      "Source-preserving improvement mode",
    );
  });

  it("hydrates reference-import documents that were not imported into the deck", async () => {
    mockCallAction.mockReset();
    mockCallAction.mockImplementation(async (name: string) =>
      name === "import-file"
        ? {
            format: "pdf",
            pageCount: 1,
            textPageCount: 1,
            pages: [{ pageNum: 1, text: "SECOND_REFERENCE_TEXT" }],
          }
        : undefined,
    );
    const deck = {
      id: "deck-multiple-reference-files",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Create a polished about us deck",
        files: [
          {
            path: "/uploads/reference.pptx",
            originalName: "reference.pptx",
            filename: "reference.pptx",
            type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            size: 1024,
          },
          {
            path: "/uploads/reference.pdf",
            originalName: "reference.pdf",
            filename: "reference.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
        referenceSelection: {
          referenceDeckId: "reference-deck-1",
          referenceFilePaths: [
            "/uploads/reference.pptx",
            "/uploads/reference.pdf",
          ],
          importedReferenceFilePath: "/uploads/reference.pptx",
        },
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    expect(mockCallAction).not.toHaveBeenCalledWith(
      "import-file",
      expect.objectContaining({ filePath: "/uploads/reference.pptx" }),
      expect.anything(),
    );
    expect(mockCallAction).toHaveBeenCalledWith(
      "import-file",
      expect.objectContaining({ filePath: "/uploads/reference.pdf" }),
      expect.anything(),
    );
    expect(agentSubmit.mock.calls[0]?.[1]).toContain("SECOND_REFERENCE_TEXT");
    expect(agentSubmit.mock.calls[0]?.[1]).not.toContain(
      "Source-preserving improvement mode",
    );
  });

  it("passes hosted URLs and inline image bytes through to agentSubmit", async () => {
    const deck = {
      id: "deck-image-1",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();
    const inlineImage = "data:image/png;base64,aW1hZ2U=";

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Make this into a deck",
        files: [
          {
            path: "/uploads/hosted.png",
            url: "https://cdn.example.test/hosted.png",
            originalName: "hosted.png",
            filename: "hosted.png",
            type: "image/png",
            size: 1024,
            dataUrl: inlineImage,
          },
          {
            path: "/uploads/inline.jpg",
            originalName: "inline.jpg",
            filename: "inline.jpg",
            type: "image/jpeg",
            size: 1024,
            dataUrl: "data:image/jpeg;base64,amBlZw==",
          },
        ],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    expect(agentSubmit.mock.calls[0]?.[2]).toMatchObject({
      referenceImagePaths: ["https://cdn.example.test/hosted.png"],
      images: [inlineImage, "data:image/jpeg;base64,amBlZw=="],
    });
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "inspect the complete visual source",
    );
  });

  it("cleans up when generation context persistence fails", async () => {
    mockCallAction.mockRejectedValueOnce(new Error("context failed"));
    const deck = {
      id: "deck-context-failure",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const deleteDeck = vi.fn();
    const onSetupFailure = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Create a deck",
        files: [],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck,
        navigate: vi.fn(),
        agentSubmit: vi.fn(),
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
        onSetupFailure,
      }),
    ).resolves.toBe("failed");

    expect(deleteDeck).toHaveBeenCalledWith(deck.id);
    expect(onSetupFailure).toHaveBeenCalledWith(
      "Create a deck",
      [],
      expect.objectContaining({ message: "context failed" }),
    );
  });

  it("imports an attached source PDF for a slide-for-slide restyling request", async () => {
    const deck = {
      id: "deck-source-1",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();
    mockCallAction.mockResolvedValue({
      imported: true,
      deckId: "deck-source-1",
      slideCount: 4,
    });

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt:
          'Please turn this into a deck with our styling. Copy it slide for slide (though note I realized a couple slides are out of order) - a couple of the "after" slides are not right after their "before" slides.',
        files: [
          {
            path: "/uploads/source.pdf",
            originalName: "source.pdf",
            filename: "source.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    expect(mockCallAction).toHaveBeenCalledWith(
      "import-file",
      {
        filePath: "/uploads/source.pdf",
        format: "pdf",
        deckId: "deck-source-1",
        importIntoDeck: true,
      },
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "Source-preserving improvement mode",
    );
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "Do not use the new-deck add-slide workflow",
    );
  });

  it("lets a hydrated PDF reference, not the generic fallback, steer styling", async () => {
    mockCallAction.mockReset();
    mockCallAction.mockImplementation(async (name: string) =>
      name === "import-file"
        ? {
            format: "pdf",
            pageCount: 1,
            textPageCount: 1,
            pages: [{ pageNum: 1, text: "Investor update" }],
            styleDigest: {
              pageCount: 1,
              pageWidthPt: 960,
              pageHeightPt: 540,
              orientation: "landscape",
              aspectRatio: 1.778,
              backgroundColors: [{ color: "#0b1020", pageCount: 1 }],
              typeScale: [
                {
                  fontSizePt: 56,
                  fontFamily: "GT Super",
                  bold: true,
                  color: "#f7f5ef",
                  runCount: 4,
                  sample: "Investor update",
                },
              ],
              paragraphAlignments: [{ alignment: "left", blockCount: 6 }],
              textMarginsPt: { left: 72, right: 72, top: 56, bottom: 56 },
              pagesWithImages: 1,
            },
          }
        : undefined,
    );
    const deck = {
      id: "deck-styled-reference",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Create a deck styled like the attached presentation",
        files: [
          {
            path: "/uploads/styled.pdf",
            originalName: "styled.pdf",
            filename: "styled.pdf",
            type: "application/pdf",
            size: 4096,
          },
        ],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    const context = agentSubmit.mock.calls[0]?.[1] as string;
    expect(context).toContain("56pt GT Super bold #f7f5ef");
    expect(context).toContain("#0b1020");
    expect(context).toContain(
      "Use the attached reference's measured visual language for tokens and slide defaults",
    );
    expect(context).not.toContain("use a light warm-neutral canvas");
    expect(context).not.toContain("Before generating a bare or on-brand deck");
    expect(context).not.toContain(
      "When no reference deck or hydrated design system is available, choose a subject-appropriate editorial direction",
    );
  });

  it("keeps the styling fallback for a reference that carries no design", async () => {
    mockCallAction.mockReset();
    mockCallAction.mockImplementation(async (name: string) =>
      name === "import-file"
        ? {
            format: "docx",
            sections: [
              { heading: "Overview", textPreview: "Why this matters" },
            ],
            textLength: 400,
          }
        : undefined,
    );
    const deck = {
      id: "deck-docx-reference",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Turn this brief into a deck",
        files: [
          {
            path: "/uploads/brief.docx",
            originalName: "brief.docx",
            filename: "brief.docx",
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size: 2048,
          },
        ],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    const context = agentSubmit.mock.calls[0]?.[1] as string;
    expect(context).toContain("Overview: Why this matters");
    expect(context).toContain("Before generating a bare or on-brand deck");
    expect(context).toContain(
      "When no reference deck or hydrated design system is available, choose a subject-appropriate editorial direction",
    );
  });

  it("keeps the generic fallback when no reference is attached", async () => {
    mockCallAction.mockReset();
    mockCallAction.mockResolvedValue(undefined);
    const deck = {
      id: "deck-no-reference",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Create a deck about our roadmap",
        files: [],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    const context = agentSubmit.mock.calls[0]?.[1] as string;
    expect(context).toContain(
      "If no workspace default exists, establish one deliberate deck-level visual contract",
    );
    expect(context).toContain(
      "When no reference deck or hydrated design system is available, choose a subject-appropriate editorial direction",
    );
  });

  it("blocks generation when an attached reference cannot be read", async () => {
    mockCallAction.mockReset();
    mockCallAction.mockImplementation(async (name: string) => {
      if (name === "import-file") {
        throw new Error(
          "Access denied: uploaded file reference is not valid for this user or organization",
        );
      }
      return undefined;
    });
    const deck = {
      id: "deck-unreadable-reference",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();
    const deleteDeck = vi.fn();
    const onSetupFailure = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Create a deck that matches the attached reference exactly",
        files: [
          {
            path: "/uploads/reference.pdf",
            originalName: "reference.pdf",
            filename: "reference.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck,
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
        onSetupFailure,
      }),
    ).resolves.toBe("failed");

    expect(agentSubmit).not.toHaveBeenCalled();
    expect(deleteDeck).toHaveBeenCalledWith(deck.id);
    const failure = onSetupFailure.mock.calls[0]?.[2] as Error;
    expect(failure.message).toContain("reference.pdf");
    expect(failure.message).toContain("Access denied");
    expect(failure.message).toContain("Generation was stopped");
  });

  it("blocks generation when an attached reference yields no readable content", async () => {
    mockCallAction.mockReset();
    mockCallAction.mockImplementation(async (name: string) =>
      name === "import-file"
        ? { format: "pdf", pageCount: 3, textPageCount: 0, pages: [] }
        : undefined,
    );
    const deck = {
      id: "deck-empty-reference",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();
    const onSetupFailure = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Use the attached PDF as the visual reference",
        files: [
          {
            path: "/uploads/scanned.pdf",
            originalName: "scanned.pdf",
            filename: "scanned.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
        onSetupFailure,
      }),
    ).resolves.toBe("failed");

    expect(agentSubmit).not.toHaveBeenCalled();
    expect((onSetupFailure.mock.calls[0]?.[2] as Error).message).toContain(
      "scanned.pdf",
    );
  });

  it("passes lightweight attachment chips into the generation", async () => {
    const deck = {
      id: "deck-retry-1",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Create a deck",
        files: [],
        attachments: [
          {
            type: "file",
            name: "reference.pdf",
            contentType: "application/pdf",
            displayOnly: true,
          },
        ],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    expect(agentSubmit.mock.calls[0]?.[2]?.attachments).toEqual([
      {
        type: "file",
        name: "reference.pdf",
        contentType: "application/pdf",
        displayOnly: true,
      },
    ]);
  });
});
