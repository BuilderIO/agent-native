import { bDeck, bRoot } from "./b-shared.js";

const C = {
  ivory: "#FBF9F4", // guard:allow-raw-color — authored slide palette, not app chrome.
  ink: "#1C1B19", // guard:allow-raw-color — authored slide palette, not app chrome.
  muted: "#5C5850", // guard:allow-raw-color — authored slide palette, not app chrome.
  oxblood: "#8A2A1F", // guard:allow-raw-color — authored slide palette, not app chrome.
  surface: "#F2EEE4", // guard:allow-raw-color — authored slide palette, not app chrome.
  rule: "#D6CFC2", // guard:allow-raw-color — authored slide palette, not app chrome.
  control: "#B3AB9C", // guard:allow-raw-color — authored slide palette, not app chrome.
};

const TOKENS = `--deck-bg:${C.ivory};--deck-ink:${C.ink};--deck-muted:${C.muted};--deck-accent:${C.oxblood};--deck-surface:${C.surface};--deck-heading-font:'EB Garamond',serif;--deck-body-font:'Source Sans 3',sans-serif;--deck-radius:2px;font-family:'Source Sans 3',sans-serif;`;

const TOTAL = 7;
const HAIR = `1px solid ${C.rule}`;
const H1 = `margin:0;font-family:'EB Garamond',serif;font-weight:400;color:var(--deck-ink);letter-spacing:-0.01em;`;
const SERIF = `font-family:var(--deck-heading-font);`;
const SMALLCAPS = `font-size:14px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--deck-muted);`;
const CAPTION = `margin:0;font-size:14px;line-height:1.45;color:var(--deck-muted);`;
const NOTE = `font-size:14px;line-height:1.45;color:var(--deck-muted);`;

/** Content slides share a running head and folio, like pages of the paper. */
const page = (n: number, style: string, body: string, footnote = "") =>
  bRoot(
    TOKENS,
    `padding:84px 72px ${footnote ? 64 : 48}px;gap:22px;${style}`,
    `<div style="position:absolute;top:30px;left:72px;right:72px;display:flex;justify-content:space-between;padding-bottom:9px;border-bottom:${HAIR};${NOTE}">
      <span style="${SERIF}font-style:italic;font-size:16px;">Structured feedback and retention — sample working paper</span>
      <span>${n} / ${TOTAL}</span>
    </div>
    ${body}
    ${footnote ? `<div style="position:absolute;left:72px;right:72px;bottom:24px;padding-top:8px;border-top:${HAIR};${NOTE}">${footnote}</div>` : ""}`,
  );

const sup = (mark: string) =>
  `<sup style="font-size:0.62em;color:var(--deck-accent);">${mark}</sup>`;

// Illustrative bar heights (px) for four waves; not data.
const WAVES: [string, number, number][] = [
  ["Week 0", 118, 116],
  ["Week 1", 150, 128],
  ["Week 2", 176, 132],
  ["Week 4", 204, 126],
];

const bar = (height: number, fill: string) => `
  <div style="position:relative;width:34px;height:${height}px;background:${fill};">
    <div style="position:absolute;left:16px;top:-18px;width:1px;height:36px;background:var(--deck-ink);"></div>
    <div style="position:absolute;left:11px;top:-18px;width:11px;height:1px;background:var(--deck-ink);"></div>
    <div style="position:absolute;left:11px;top:17px;width:11px;height:1px;background:var(--deck-ink);"></div>
  </div>`;

const key = (fill: string, label: string) =>
  `<span style="display:inline-flex;align-items:center;gap:8px;"><span style="width:14px;height:14px;background:${fill};"></span>${label}</span>`;

const methodBox = (text: string, strong = false) =>
  `<div style="border:1px solid ${strong ? "var(--deck-ink)" : C.rule};background:${strong ? "var(--deck-bg)" : "var(--deck-surface)"};padding:10px 14px;font-size:16px;line-height:1.35;text-align:center;">${text}</div>`;

const stem = `<div style="width:1px;height:18px;background:var(--deck-ink);margin:0 auto;"></div>`;

const defRow = (term: string, text: string) =>
  `<div style="display:grid;grid-template-columns:118px 1fr;gap:16px;padding:11px 0;border-top:${HAIR};"><dt style="${SMALLCAPS}padding-top:2px;">${term}</dt><dd style="margin:0;font-size:16px;line-height:1.45;">${text}</dd></div>`;

const TD = `padding:9px 14px;text-align:right;font-variant-numeric:tabular-nums;`;
const row = (label: string, cells: string[], top = false) =>
  `<tr style="${top ? `border-top:1px solid ${C.ink};` : ""}"><td style="padding:9px 14px 9px 0;">${label}</td>${cells.map((cell) => `<td style="${TD}">${cell}</td>`).join("")}</tr>`;

const limitation = (title: string, text: string) =>
  `<div style="display:flex;flex-direction:column;gap:6px;padding-top:14px;border-top:${HAIR};"><h2 style="margin:0;${SERIF}font-style:italic;font-weight:400;font-size:24px;">${title}</h2><p style="margin:0;font-size:16px;line-height:1.5;">${text}</p></div>`;

const reference = (text: string) =>
  `<li style="padding-left:32px;text-indent:-32px;font-size:16px;line-height:1.5;">${text}</li>`;

export const RESEARCH_DECK = bDeck(
  "starter-research",
  "Research Findings",
  "report",
  "A quiet, rigorous findings talk: ivory pages, Garamond headings, numbered figures with captions, footnotes, and a proper references slide.",
  [
    [
      "title",
      bRoot(
        TOKENS,
        `padding:64px 72px;flex-direction:row;gap:56px;`,
        `<div style="flex:1.35;display:flex;flex-direction:column;justify-content:space-between;">
          <span style="${SMALLCAPS}">Working paper · No. 00 · Month 2026</span>
          <div style="display:flex;flex-direction:column;gap:22px;">
            <h1 style="${H1}font-size:46px;line-height:1.08;">Structured feedback and learning retention: evidence from a sample cohort</h1>
            <p style="margin:0;font-size:19px;line-height:1.45;">Firstname Lastname${sup("1")}, Firstname Lastname${sup("2")}, and Firstname Lastname${sup("1")}</p>
          </div>
          <div style="${NOTE}"><div>${sup("1")} Department of Sample Studies, University Name</div><div>${sup("2")} Institute Name, City</div></div>
        </div>
        <div style="flex:1;border-left:${HAIR};padding-left:36px;display:flex;flex-direction:column;justify-content:center;gap:12px;">
          <h2 style="margin:0;${SMALLCAPS}color:var(--deck-accent);">Abstract</h2>
          <div style="${SERIF}font-size:18px;line-height:1.5;">We test whether structured, timely feedback improves retention after four weeks. In a randomised sample of 000 participants, the treatment group retained more at every follow-up, and the gap widened over time. Replace this abstract with your own; keep it under 90 words.</div>
          <div style="${NOTE}font-style:italic;">Keywords: feedback, retention, randomised design</div>
        </div>`,
      ),
      "Introduce the paper by its question, not its title. Name your co-authors and affiliations. All names, numbers, and the abstract are placeholders; replace them with the paper's own text.",
    ],
    [
      "content",
      page(
        2,
        `justify-content:center;`,
        `<h1 style="${H1}font-size:38px;line-height:1.1;">Research question</h1>
        <p style="margin:0;${SERIF}font-style:italic;font-size:32px;line-height:1.3;max-width:760px;padding-left:22px;border-left:1px solid var(--deck-accent);">Does structured, timely feedback change how much learners retain four weeks later?${sup("a")}</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:10px;">
          <div style="display:flex;gap:16px;"><span style="${SERIF}font-style:italic;font-size:26px;color:var(--deck-accent);line-height:1;">H1</span><span style="font-size:17px;line-height:1.5;">Participants receiving structured feedback score higher on the week-4 retention test than controls.</span></div>
          <div style="display:flex;gap:16px;"><span style="${SERIF}font-style:italic;font-size:26px;color:var(--deck-accent);line-height:1;">H2</span><span style="font-size:17px;line-height:1.5;">The difference between groups grows between the first and final follow-up.</span></div>
        </div>`,
        `${sup("a")} Retention is the share of items answered correctly on a delayed test. Hypotheses pre-registered before data collection (sample ID 0000).`,
      ),
      "State the question in one sentence and read both hypotheses aloud. The pre-registration ID and definitions are placeholders; replace them with your study's own before presenting.",
    ],
    [
      "content",
      page(
        3,
        ``,
        `<h1 style="${H1}font-size:38px;line-height:1.1;">Methodology</h1>
        <div style="flex:1;display:grid;grid-template-columns:1fr 1.1fr;gap:48px;">
          <figure style="margin:0;display:flex;flex-direction:column;gap:12px;">
            <div style="display:flex;flex-direction:column;">
              ${methodBox("Recruited and screened, n = 000", true)}${stem}
              ${methodBox("Randomised 1 : 1")}${stem}
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">${methodBox("Structured feedback<br>n = 000")}${methodBox("Standard feedback<br>n = 000")}</div>${stem}
              ${methodBox("Tested at weeks 0, 1, 2, and 4", true)}
            </div>
            <p style="${CAPTION}"><b style="color:var(--deck-ink);">Fig. 1.</b> Study design and participant flow. Sample values.</p>
          </figure>
          <dl style="margin:0;">
            ${defRow("Design", "Two-arm randomised trial, pre-registered, analyst blind to condition.")}
            ${defRow("Sample", "000 adult learners from 0 sites; describe eligibility here.")}
            ${defRow("Measure", "Delayed recall test, 00 items, parallel forms at each wave.")}
            ${defRow("Analysis", "Mixed-effects model with random intercepts for participant and site.")}
          </dl>
        </div>`,
      ),
      "Walk the design top to bottom, then the four definitions. Audiences trust findings they can picture the method behind. Every n and site count is a placeholder; replace with the real CONSORT-style numbers.",
    ],
    [
      "content",
      page(
        4,
        ``,
        `<h1 style="${H1}font-size:36px;line-height:1.1;">Finding 1 — the gap widens over time</h1>
        <div style="flex:1;display:grid;grid-template-columns:1.45fr 1fr;gap:44px;">
          <figure style="margin:0;display:flex;flex-direction:column;gap:10px;">
            <div style="position:relative;margin:12px 0 0 40px;height:224px;display:flex;align-items:flex-end;justify-content:space-around;border-left:1px solid var(--deck-ink);border-bottom:1px solid var(--deck-ink);background:repeating-linear-gradient(180deg,${C.rule} 0 1px,transparent 1px 56px);">
              ${["100", "75", "50", "25", "0"].map((tick, index) => `<span style="position:absolute;right:calc(100% + 10px);top:${index * 56 - 10}px;${NOTE}">${tick}</span>`).join("")}
              ${WAVES.map(([, treated, control]) => `<div style="display:flex;align-items:flex-end;gap:6px;">${bar(treated, "var(--deck-accent)")}${bar(control, C.control)}</div>`).join("")}
            </div>
            <div style="display:flex;justify-content:space-around;margin-left:40px;${NOTE}">${WAVES.map(([label]) => `<span>${label}</span>`).join("")}</div>
            <figcaption style="${CAPTION}"><b style="color:var(--deck-ink);">Fig. 2.</b> Mean retention score by condition and wave; bars show 95% CIs. Illustrative sample data.</figcaption>
          </figure>
          <div style="display:flex;flex-direction:column;justify-content:center;gap:18px;">
            <div style="display:flex;gap:20px;${NOTE}color:var(--deck-ink);">${key("var(--deck-accent)", "Structured")}${key(C.control, "Standard")}</div>
            <p style="margin:0;${SERIF}font-size:24px;line-height:1.35;">Groups start level, then diverge. By week 4 the difference is d = 0.00 [0.00, 0.00].${sup("b")}</p>
            <p style="margin:0;font-size:16px;line-height:1.5;color:var(--deck-muted);">Consistent with H1 and H2. The control group plateaus after week 1.</p>
          </div>
        </div>`,
        `${sup("b")} Cohen's d with 95% confidence interval, estimated from Model 3 in Table 1.`,
      ),
      "The headline finding. Point to week 0 first to show the groups started level, then to week 4. The chart is illustrative sample data; rebuild the bar heights and effect size from your own results before presenting.",
    ],
    [
      "content",
      page(
        5,
        ``,
        `<h1 style="${H1}font-size:36px;line-height:1.1;">Estimates hold across specifications</h1>
        <p style="${CAPTION}font-size:15px;"><b style="color:var(--deck-ink);">Table 1.</b> Mixed-effects estimates of retention score. Standard errors in parentheses.</p>
        <table style="width:100%;border-collapse:collapse;font-size:17px;border-top:2px solid var(--deck-ink);border-bottom:2px solid var(--deck-ink);">
          <thead><tr style="border-bottom:1px solid var(--deck-ink);"><th style="padding:9px 14px 9px 0;text-align:left;font-weight:600;">Predictor</th><th style="${TD}font-weight:600;">Model 1</th><th style="${TD}font-weight:600;">Model 2</th><th style="${TD}font-weight:600;">Model 3</th></tr></thead>
          <tbody>
            ${row("Structured feedback", ["0.00*** (0.00)", "0.00*** (0.00)", "0.00** (0.00)"])}
            ${row("Week", ["", "0.00* (0.00)", "0.00 (0.00)"])}
            ${row("Feedback × Week", ["", "", "0.00*** (0.00)"])}
            ${row("Baseline controls", ["No", "Yes", "Yes"], true)}
            ${row("Observations", ["000", "000", "000"])}
          </tbody>
        </table>
        <p style="${CAPTION}">Note. * p &lt; .05, ** p &lt; .01, *** p &lt; .001. All values are placeholders.</p>`,
      ),
      "Don't read the table; point to the treatment row and the interaction term. Every coefficient is a placeholder formatted like a real estimate. Paste your model output and keep the significance legend.",
    ],
    [
      "content",
      page(
        6,
        ``,
        `<h1 style="${H1}font-size:38px;line-height:1.1;">Limitations</h1>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:26px 48px;">
          ${limitation("Sample", "Participants self-selected into the study, so effects may be larger than in a general population.")}
          ${limitation("Measurement", "One retention test format; we cannot say whether effects transfer to applied tasks.")}
          ${limitation("Duration", "Follow-up ends at four weeks. Longer-term retention remains untested.")}
          ${limitation("Setting", "All sites shared one curriculum. Replication in other settings is needed.")}
        </div>`,
      ),
      "Credibility comes from naming your own weaknesses before the audience does. Replace these four with the real limitations of your study, and say which one you'd fix first with more funding.",
    ],
    [
      "content",
      page(
        7,
        ``,
        `<h1 style="${H1}font-size:38px;line-height:1.1;">References</h1>
        <ol style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px;">
          ${reference("Author, A. A., &amp; Author, B. B. (2024). Title of a cited article in sentence case. <i>Journal Name, 00</i>(0), 000–000.")}
          ${reference("Author, C. (2023). <i>Title of a cited book in sentence case</i>. Publisher Name.")}
          ${reference("Author, D., Author, E., &amp; Author, F. (2022). Title of a conference paper. In <i>Proceedings of the Sample Conference</i> (pp. 00–00).")}
          ${reference("Organisation Name. (2021). <i>Title of a technical report</i> (Report No. 00). Publisher Name.")}
          ${reference("Author, G., &amp; Author, H. (2020). Title of a replication study. <i>Journal Name, 00</i>, 000–000.")}
          ${reference("Author, I. (2019). Title of a methods paper describing the retention measure. <i>Journal Name, 00</i>(0), 00–00.")}
        </ol>
        <p style="margin:auto 0 0;padding-top:14px;border-top:${HAIR};font-size:15px;line-height:1.5;color:var(--deck-muted);">Correspondence: firstname.lastname@university.example · Data and materials available on request.</p>`,
      ),
      "Leave this up during questions so people can note sources. Replace each placeholder with a real citation in your field's style, and update the correspondence line.",
    ],
  ],
);
