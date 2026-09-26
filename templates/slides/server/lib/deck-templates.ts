export const DECK_TEMPLATE_CATEGORIES = [
  "pitch",
  "update",
  "company",
  "quarterly",
  "case-study",
  "workshop",
] as const;
export type DeckTemplateCategory = (typeof DECK_TEMPLATE_CATEGORIES)[number];

type Palette = {
  background: string;
  ink: string;
  muted: string;
  accent: string;
  surface: string;
  heading: string;
};

function palette(
  [background, ink, muted, accent, surface]: [
    string,
    string,
    string,
    string,
    string,
  ],
  heading: string,
): Palette {
  return { background, ink, muted, accent, surface, heading };
}
type Page = {
  title: string;
  label: string;
  body: string;
  points?: readonly [string, string][];
  layout?: "title" | "statement" | "content";
  notes: string;
};
export interface DeckTemplateSlide {
  id: string;
  content: string;
  layout: "title" | "statement" | "content";
  notes: string;
}
export interface DeckTemplate {
  id: string;
  title: string;
  description: string;
  category: DeckTemplateCategory;
  aspectRatio: "16:9";
  width: 960;
  height: 540;
  isBuiltIn: true;
  version: 1;
  slides: DeckTemplateSlide[];
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

function titleArt(category: DeckTemplateCategory): string {
  if (category === "pitch") {
    return `<div class="deck-art deck-art-pitch"><span class="art-orbit"></span><span class="art-orbit art-orbit-small"></span><span class="art-card"><b>01</b><small>THE IDEA</small></span><span class="art-caption">MAKE<br />THE<br />SHIFT</span></div>`;
  }
  if (category === "update") {
    return `<div class="deck-art deck-art-update"><div class="art-date">Q3<br /><b>25</b></div><div class="art-bars"><span></span><span></span><span></span><span></span></div><div class="art-caption">IN<br />MOTION</div></div>`;
  }
  if (category === "company") {
    return `<div class="deck-art deck-art-company"><div class="art-window"><span></span><span></span><span></span></div><div class="art-circle"></div><div class="art-caption">PEOPLE<br />MAKE<br />MEANING</div></div>`;
  }
  if (category === "quarterly") {
    return `<div class="deck-art deck-art-quarterly"><div class="art-chart"><span></span><span></span><span></span><span></span><span></span></div><div class="art-line"></div><div class="art-caption">LOOK<br />BACK<br />MOVE<br />FORWARD</div></div>`;
  }
  if (category === "case-study") {
    return `<div class="deck-art deck-art-case-study"><div class="art-photo"><span></span><span></span><span></span></div><div class="art-quote">“</div><div class="art-caption">A STORY<br />WORTH<br />SHARING</div></div>`;
  }
  return `<div class="deck-art deck-art-workshop"><div class="art-note note-one">NOTICE</div><div class="art-note note-two">QUESTION</div><div class="art-note note-three">TRY</div><div class="art-caption">MAKE<br />SPACE<br />FOR IT</div></div>`;
}

function renderSlide(
  page: Page,
  palette: Palette,
  index: number,
  count: number,
  category: DeckTemplateCategory,
): string {
  const titlePage = page.layout === "title";
  const headingSize = titlePage ? 66 : page.layout === "statement" ? 52 : 40;
  const points =
    page.points
      ?.map(
        ([title, body], position) =>
          `<div style="display:grid;grid-template-columns:28px 1fr;gap:12px;padding:12px 0;border-top:1px solid var(--deck-muted);"><span style="font-size:16px;color:var(--deck-accent);font-weight:700;">${String(position + 1).padStart(2, "0")}</span><div><h3 style="margin:0 0 5px;font-size:21px;line-height:1.2;font-weight:600;">${escapeHtml(title)}</h3><p style="margin:0;font-size:17px;line-height:1.4;color:var(--deck-muted);">${escapeHtml(body)}</p></div></div>`,
      )
      .join("") ?? "";
  const centered = titlePage && category === "workshop";
  const editorial =
    titlePage && (category === "company" || category === "case-study");
  const agenda =
    titlePage && (category === "update" || category === "quarterly");
  const titleLayout =
    "display:grid;grid-template-columns:minmax(0,1.12fr) minmax(260px,.88fr);gap:34px;align-items:center;";
  const mainStyle = points
    ? "display:grid;grid-template-columns:320px 1fr;gap:44px;align-items:center;"
    : titlePage
      ? titleLayout
      : `display:flex;flex-direction:column;justify-content:${editorial ? "flex-end" : "center"};${centered ? "align-items:center;text-align:center;" : ""}${editorial ? "padding-bottom:36px;" : ""}`;
  const heading = `<h1 style="font-family:var(--deck-heading-font);font-size:${headingSize}px;line-height:1.06;font-weight:600;letter-spacing:-0.035em;max-width:${editorial ? "690" : "810"}px;margin:0 0 18px;">${escapeHtml(page.title)}</h1>`;
  const introduction = `<p style="font-size:${titlePage ? "24" : "18"}px;line-height:1.4;color:var(--deck-muted);max-width:730px;margin:0;">${escapeHtml(page.body)}</p>`;
  return `<div class="fmd-slide" style="--deck-bg:${palette.background};--deck-ink:${palette.ink};--deck-muted:${palette.muted};--deck-accent:${palette.accent};--deck-surface:${palette.surface};--deck-heading-font:${palette.heading};--deck-body-font:Arial,sans-serif;--deck-radius:0px;width:960px;height:540px;box-sizing:border-box;padding:42px 56px;background:var(--deck-bg);color:var(--deck-ink);font-family:var(--deck-body-font);display:flex;flex-direction:column;">
<style>
.deck-title-copy{min-width:0}.deck-art{position:relative;height:260px;overflow:hidden;border:1px solid color-mix(in srgb,var(--deck-ink) 18%,transparent);background:var(--deck-surface)}.deck-art span,.deck-art div{box-sizing:border-box}.art-caption{position:absolute;right:18px;bottom:16px;font-size:13px;line-height:1.05;font-weight:700;letter-spacing:.14em;text-align:right;color:var(--deck-ink)}
.deck-art-pitch{background:var(--deck-accent);transform:rotate(2deg)}.deck-art-pitch .art-orbit{position:absolute;width:190px;height:190px;right:-34px;top:-26px;border:24px solid var(--deck-surface);border-radius:50%}.deck-art-pitch .art-orbit-small{width:122px;height:122px;right:46px;top:44px;border-width:8px;border-color:var(--deck-ink)}.art-card{position:absolute;left:24px;top:28px;width:132px;height:164px;padding:18px;background:var(--deck-bg);box-shadow:10px 10px 0 var(--deck-ink);transform:rotate(-7deg);display:flex;flex-direction:column;justify-content:space-between}.art-card b{font-size:46px;line-height:1}.art-card small{font-size:11px;letter-spacing:.15em}.deck-art-pitch .art-caption{color:var(--deck-bg)}
.deck-art-update{background:linear-gradient(145deg,var(--deck-surface),var(--deck-bg));}.art-date{position:absolute;left:22px;top:20px;font-size:26px;line-height:.9;letter-spacing:-.06em}.art-date b{font-size:86px;letter-spacing:-.1em}.art-bars{position:absolute;right:22px;top:28px;display:flex;align-items:end;gap:10px;height:160px}.art-bars span{display:block;width:24px;background:var(--deck-accent)}.art-bars span:nth-child(1){height:54px}.art-bars span:nth-child(2){height:94px;background:var(--deck-ink)}.art-bars span:nth-child(3){height:128px}.art-bars span:nth-child(4){height:160px;background:var(--deck-muted)}
.deck-art-company{background:var(--deck-bg)}.art-window{position:absolute;inset:28px 26px 42px;background:var(--deck-surface);padding:18px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.art-window span{display:block;background:var(--deck-accent)}.art-window span:nth-child(2){background:var(--deck-ink);margin-top:22px}.art-window span:nth-child(3){background:var(--deck-muted);margin-top:48px}.art-circle{position:absolute;width:108px;height:108px;right:28px;top:56px;border-radius:50%;background:var(--deck-accent);mix-blend-mode:multiply}.deck-art-company .art-caption{color:var(--deck-bg)}
.deck-art-quarterly{background:var(--deck-surface)}.art-chart{position:absolute;left:22px;right:22px;bottom:32px;height:164px;display:flex;align-items:end;gap:12px;border-bottom:2px solid var(--deck-ink)}.art-chart span{display:block;flex:1;background:var(--deck-accent)}.art-chart span:nth-child(1){height:38%}.art-chart span:nth-child(2){height:62%;background:var(--deck-muted)}.art-chart span:nth-child(3){height:48%}.art-chart span:nth-child(4){height:82%;background:var(--deck-ink)}.art-chart span:nth-child(5){height:100%}.art-line{position:absolute;left:22px;right:22px;top:76px;border-top:3px solid var(--deck-accent);transform:rotate(-10deg)}.deck-art-quarterly .art-caption{top:18px;right:20px;bottom:auto}
.deck-art-case-study{background:var(--deck-ink)}.art-photo{position:absolute;left:24px;top:24px;width:56%;height:182px;background:var(--deck-accent);display:grid;grid-template-columns:1.4fr .7fr;gap:10px;padding:10px;transform:rotate(-4deg)}.art-photo span{background:var(--deck-surface)}.art-photo span:nth-child(2){background:var(--deck-muted)}.art-photo span:nth-child(3){grid-column:1 / -1;background:var(--deck-bg)}.art-quote{position:absolute;right:34px;top:24px;color:var(--deck-accent);font-family:var(--deck-heading-font);font-size:130px;line-height:.7}.deck-art-case-study .art-caption{color:var(--deck-bg)}
.deck-art-workshop{background:var(--deck-surface)}.art-note{position:absolute;width:116px;height:92px;padding:12px;background:var(--deck-accent);font-size:13px;font-weight:700;letter-spacing:.1em;box-shadow:7px 7px 0 var(--deck-ink)}.note-one{left:24px;top:34px;transform:rotate(-8deg)}.note-two{left:112px;top:118px;background:var(--deck-bg);transform:rotate(5deg)}.note-three{left:214px;top:46px;background:var(--deck-muted);transform:rotate(8deg)}.deck-art-workshop .art-caption{color:var(--deck-ink)}
@media (max-width:700px){.deck-art{height:180px}.art-card{transform:scale(.8) rotate(-7deg);transform-origin:top left}.art-caption{font-size:10px}}
</style>
<header style="display:flex;justify-content:space-between;align-items:center;font-size:16px;line-height:1.25;color:var(--deck-muted);"><span>${escapeHtml(page.label)}</span><span>${String(index + 1).padStart(2, "0")} / ${String(count).padStart(2, "0")}</span></header>
<main style="flex:1;${mainStyle}">
${points ? `<div>${heading}${introduction}</div><div>${points}</div>` : titlePage ? `<div class="deck-title-copy">${heading}${introduction}</div><div>${titleArt(category)}</div>` : `${heading}${introduction}`}
${agenda ? `<div style="display:flex;gap:24px;margin-top:36px;border-top:2px solid var(--deck-accent);padding-top:16px;font-size:17px;">${category === "update" ? "<span>Progress</span><span>Decisions</span><span>Next</span>" : "<span>Evidence</span><span>Learning</span><span>Priorities</span>"}</div>` : titlePage ? `<div style="height:${editorial ? "2" : "8"}px;width:${centered ? "64px" : editorial ? "100%" : "112px"};background:var(--deck-accent);margin-top:34px;"></div>` : ""}
</main>
<footer style="display:flex;justify-content:space-between;align-items:center;padding-top:14px;font-size:16px;line-height:1.2;color:var(--deck-muted);"><span>Editable starter</span><span style="color:var(--deck-accent);">${escapeHtml(page.label.split(" / ")[0])}</span></footer>
</div>`;
}

function template(
  id: string,
  title: string,
  category: DeckTemplateCategory,
  description: string,
  palette: Palette,
  pages: readonly Page[],
): DeckTemplate {
  return {
    id,
    title,
    category,
    description,
    aspectRatio: "16:9",
    width: 960,
    height: 540,
    isBuiltIn: true,
    version: 1,
    slides: pages.map((page, index) => ({
      id: `${id}-${index + 1}`,
      content: renderSlide(page, palette, index, pages.length, category),
      layout: page.layout ?? "content",
      notes: page.notes,
    })),
  };
}

const templates: readonly DeckTemplate[] = [
  template(
    "starter-pitch",
    "The pitch",
    "pitch",
    "A focused narrative from problem to next step.",
    palette(
      // guard:allow-raw-color — authored pitch slide palette, not app chrome.
      ["#142B36", "#F5F7EE", "#B6C6CB", "#D8ED74", "#203C47"],
      "Arial,sans-serif",
    ),
    [
      {
        label: "PITCH / THE IDEA",
        layout: "title",
        title: "A better way forward.",
        body: "Company name · A clear promise to the people you serve.",
        notes:
          "Replace the company name and promise with your own. This starter contains no business performance claims.",
      },
      {
        label: "PITCH / THE PROBLEM",
        title: "Start with the friction.",
        body: "Make the problem specific before you introduce the solution.",
        points: [
          [
            "Who feels it",
            "Describe the person, team, or customer facing the problem.",
          ],
          [
            "What gets in the way",
            "Name the workaround and the cost of leaving it unchanged.",
          ],
          [
            "Why it matters now",
            "Use a verified observation that makes the timing clear.",
          ],
        ],
        notes:
          "Replace these prompts with evidence from your own customer research.",
      },
      {
        label: "PITCH / THE APPROACH",
        title: "One idea. A simpler path.",
        body: "Connect the product to the outcome, step by step.",
        points: [
          [
            "Begin with the need",
            "Show how someone starts and what they bring.",
          ],
          [
            "Remove the hard part",
            "Explain the core capability in plain language.",
          ],
          [
            "Make progress visible",
            "Describe the result the customer can verify.",
          ],
        ],
        notes:
          "Use actual product capabilities. Add editable screenshots later if useful.",
      },
      {
        label: "PITCH / THE EVIDENCE",
        layout: "statement",
        title: "Proof before promises.",
        body: "Add a verified customer observation, product demonstration, or measured result. Name its source and date.",
        notes:
          "No metric is supplied. Only add performance claims you can substantiate.",
      },
      {
        label: "PITCH / THE NEXT STEP",
        title: "Make the ask concrete.",
        body: "End with a decision your audience can make.",
        points: [
          [
            "The request",
            "State the commitment or resource you are asking for.",
          ],
          ["The milestone", "Describe what that commitment makes possible."],
          ["The follow-through", "Name the owner and the next conversation."],
        ],
        notes: "Replace the asks and milestones with your actual plan.",
      },
    ],
  ),
  template(
    "starter-update",
    "Team update",
    "update",
    "Progress, priorities, and decisions in one calm readout.",
    palette(
      // guard:allow-raw-color — authored team-update slide palette, not app chrome.
      ["#EDF4EE", "#183C2B", "#476451", "#24664D", "#DCEADD"],
      "Arial,sans-serif",
    ),
    [
      {
        label: "TEAM UPDATE / THIS WEEK",
        layout: "title",
        title: "The work, in focus.",
        body: "Team name · Reporting period · One shared view of progress.",
        notes: "Replace the team name and reporting period.",
      },
      {
        label: "TEAM UPDATE / PROGRESS",
        title: "What moved forward?",
        body: "Report outcomes, not just activity.",
        points: [
          [
            "Delivered",
            "Name the work that is complete and where it can be reviewed.",
          ],
          [
            "Learned",
            "Share one observation that changed the team's understanding.",
          ],
          ["In motion", "Describe the next meaningful milestone."],
        ],
        notes:
          "Replace each row with current team information. Do not imply completion without a verified result.",
      },
      {
        label: "TEAM UPDATE / DECISIONS",
        title: "Where we need alignment.",
        body: "Separate a decision from a dependency.",
        points: [
          [
            "Decision to make",
            "State the choice, the options, and who can decide.",
          ],
          [
            "Dependency to resolve",
            "Name what is needed and the person who can unblock it.",
          ],
          ["Risk to watch", "Describe the signal that would change the plan."],
        ],
        notes: "Make ownership explicit and use real dates when known.",
      },
      {
        label: "TEAM UPDATE / NEXT",
        layout: "statement",
        title: "One priority for the next cycle.",
        body: "Replace this statement with the outcome that matters most. Add the owner, checkpoint, and definition of done.",
        notes:
          "Keep the priority singular. Add other work in a separate slide if it is essential.",
      },
    ],
  ),
  template(
    "starter-company",
    "Company introduction",
    "company",
    "An editorial introduction to purpose, work, and people.",
    palette(
      // guard:allow-raw-color — authored company slide palette, not app chrome.
      ["#F4F1E9", "#322D28", "#6C6259", "#A34436", "#E7E0D5"],
      "Georgia,serif",
    ),
    [
      {
        label: "COMPANY / INTRODUCTION",
        layout: "title",
        title: "Built around a clear purpose.",
        body: "Company name · What you do, and who you do it for.",
        notes:
          "Replace the company name and purpose. No fictional customer logos or company claims are included.",
      },
      {
        label: "COMPANY / PURPOSE",
        layout: "statement",
        title: "The change we are here to make.",
        body: "Describe the customer need that motivates your work. Keep the promise concrete and the language human.",
        notes:
          "Write your actual purpose rather than an unsupported market claim.",
      },
      {
        label: "COMPANY / OUR WORK",
        title: "What we bring to the table.",
        body: "Three capabilities, explained through the value they provide.",
        points: [
          [
            "Capability one",
            "Describe a real service or product and the need it serves.",
          ],
          ["Capability two", "Show how this complements the first capability."],
          ["Capability three", "Explain what makes your approach distinctive."],
        ],
        notes:
          "Replace these labels and descriptions with current capabilities.",
      },
      {
        label: "COMPANY / HOW WE WORK",
        title: "Principles made practical.",
        body: "Describe the behaviors a customer or colleague can expect.",
        points: [
          ["Listen carefully", "Make room for the context behind the request."],
          [
            "Work transparently",
            "Show the reasoning, trade-offs, and progress.",
          ],
          [
            "Follow through",
            "Agree on what good looks like and verify the result.",
          ],
        ],
        notes:
          "These are suggested principles, not claims about an existing company. Edit them to match your practice.",
      },
      {
        label: "COMPANY / LET'S TALK",
        layout: "statement",
        title: "The next conversation starts here.",
        body: "Add the right contact, a relevant question, and a useful next step.",
        notes:
          "Supply your own contact information. This starter does not include external links.",
      },
    ],
  ),
  template(
    "starter-quarterly",
    "Quarterly review",
    "quarterly",
    "A deliberate structure for evidence, lessons, and priorities.",
    palette(
      // guard:allow-raw-color — authored quarterly-review slide palette, not app chrome.
      ["#EAF0F6", "#213347", "#51657A", "#275E9C", "#D7E3EF"],
      "Arial,sans-serif",
    ),
    [
      {
        label: "QUARTERLY REVIEW / OVERVIEW",
        layout: "title",
        title: "A quarter in perspective.",
        body: "Team or business name · Quarter and year · Review and reset.",
        notes:
          "Replace the reporting period and scope. No sample metrics are presented as actual results.",
      },
      {
        label: "QUARTERLY REVIEW / OUTCOMES",
        title: "Compare intent with evidence.",
        body: "Use your own source-backed results for each priority.",
        points: [
          [
            "What we set out to do",
            "Record the intended outcome and the original baseline.",
          ],
          [
            "What actually happened",
            "Add the verified result, its source, and any uncertainty.",
          ],
          [
            "What explains the difference",
            "Separate what you know from what still needs investigation.",
          ],
        ],
        notes:
          "If a result is not measured, state that explicitly. Do not replace missing results with invented numbers.",
      },
      {
        label: "QUARTERLY REVIEW / LEARNING",
        title: "Keep. Change. Stop.",
        body: "Turn the review into choices about how you work.",
        points: [
          [
            "Keep",
            "A practice that helped and the evidence for continuing it.",
          ],
          [
            "Change",
            "A constraint to address and a specific adjustment to test.",
          ],
          ["Stop", "Work that no longer supports the most important outcome."],
        ],
        notes:
          "Use concrete examples from the period rather than generic retrospective language.",
      },
      {
        label: "QUARTERLY REVIEW / NEXT QUARTER",
        layout: "statement",
        title: "Choose the next priority.",
        body: "Name the outcome, accountable owner, evidence of progress, and first checkpoint.",
        notes:
          "Add a real goal and measurement plan. This starter does not assume growth or a successful quarter.",
      },
    ],
  ),
  template(
    "starter-case-study",
    "Case study",
    "case-study",
    "A source-conscious story of a challenge and response.",
    palette(
      // guard:allow-raw-color — authored case-study slide palette, not app chrome.
      ["#292927", "#F7F2E9", "#C2BBB0", "#E5A782", "#3B3935"],
      "Georgia,serif",
    ),
    [
      {
        label: "CASE STUDY / THE STORY",
        layout: "title",
        title: "From challenge to change.",
        body: "Project name · Customer or team · The story behind the work.",
        notes:
          "Use a customer name only with permission. Replace all project placeholders.",
      },
      {
        label: "CASE STUDY / CONTEXT",
        title: "Set the scene.",
        body: "Help the audience understand the starting point.",
        points: [
          [
            "The situation",
            "Describe the setting without exposing confidential details.",
          ],
          [
            "The challenge",
            "Name the problem and why it mattered to the people involved.",
          ],
          [
            "The constraints",
            "Make the real limits on time, resources, or scope visible.",
          ],
        ],
        notes:
          "Verify permission for customer information and any quotes before publishing.",
      },
      {
        label: "CASE STUDY / RESPONSE",
        title: "Show the choices that mattered.",
        body: "Explain the work through decisions, not a list of activities.",
        points: [
          [
            "Understand",
            "Describe the research or evidence that shaped the approach.",
          ],
          ["Create", "Explain the solution and the trade-off behind it."],
          ["Adapt", "Show how feedback changed the work."],
        ],
        notes:
          "Replace this suggested process with the actual sequence of work.",
      },
      {
        label: "CASE STUDY / RESULT",
        layout: "statement",
        title: "Let the evidence carry the story.",
        body: "Add a verified result or approved quote. Include its source, date, and limits. If the work is still in progress, say so.",
        notes:
          "No testimonial or metric is supplied. Do not invent an outcome to complete the story.",
      },
      {
        label: "CASE STUDY / TAKEAWAY",
        layout: "statement",
        title: "What others can learn.",
        body: "State the lesson, where it applies, and what you would do differently next time.",
        notes: "Keep the conclusion proportional to the evidence.",
      },
    ],
  ),
  template(
    "starter-workshop",
    "Working session",
    "workshop",
    "A facilitation-ready sequence from shared question to action.",
    palette(
      // guard:allow-raw-color — authored workshop slide palette, not app chrome.
      ["#F1EDF7", "#352747", "#6A587B", "#704A99", "#E3DBED"],
      "Arial,sans-serif",
    ),
    [
      {
        label: "WORKSHOP / WELCOME",
        layout: "title",
        title: "Make space for a better answer.",
        body: "Session topic · Facilitator · A shared question worth exploring.",
        notes:
          "Replace the session topic and facilitator. The agenda is a suggested format, not a calendar booking.",
      },
      {
        label: "WORKSHOP / THE QUESTION",
        layout: "statement",
        title: "What are we trying to change?",
        body: "Write one open question. Name what is in scope, what is not, and the decision this session should enable.",
        notes:
          "Read the question aloud and confirm agreement before moving on.",
      },
      {
        label: "WORKSHOP / THE SESSION",
        title: "A simple working rhythm.",
        body: "Suggested agenda. Adjust the timing to fit your group.",
        points: [
          [
            "Explore · 10 minutes",
            "Write observations individually before discussing them.",
          ],
          [
            "Connect · 15 minutes",
            "Group related ideas and compare different perspectives.",
          ],
          [
            "Decide · 10 minutes",
            "Choose one experiment and agree how to evaluate it.",
          ],
        ],
        notes:
          "Timings are editable facilitation suggestions. Offer a break or more time when the group needs it.",
      },
      {
        label: "WORKSHOP / THE EXERCISE",
        title: "Notice. Question. Suggest.",
        body: "Keep observations distinct from interpretations.",
        points: [
          ["I notice…", "Share something specific you have seen or heard."],
          ["I wonder…", "Ask a question that opens up the discussion."],
          ["We could try…", "Propose a small, testable next step."],
        ],
        notes:
          "Invite each participant to contribute. Record actual contributions in the editable slide.",
      },
      {
        label: "WORKSHOP / CLOSE",
        layout: "statement",
        title: "Leave with one clear commitment.",
        body: "Record the action, owner, first checkpoint, and evidence you will bring back.",
        notes:
          "Confirm that the owner accepts the action and share a record of the decision.",
      },
    ],
  ),
];

export function listBuiltInDeckTemplates(): DeckTemplate[] {
  return templates.map((item) => structuredClone(item));
}

export function getBuiltInDeckTemplate(id: string): DeckTemplate | undefined {
  const item = templates.find((candidate) => candidate.id === id);
  return item ? structuredClone(item) : undefined;
}

export function listBuiltInDeckTemplateSummaries(includePreview = false) {
  return templates.map(({ slides, ...metadata }) => ({
    ...metadata,
    slideCount: slides.length,
    ...(includePreview ? { previewHtml: slides[0].content } : {}),
  }));
}
