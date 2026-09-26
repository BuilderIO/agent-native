import { bDeck, bRoot, tint } from "./b-shared.js";

const C = {
  cream: "#FFF8EE", // guard:allow-raw-color — authored slide palette, not app chrome.
  navy: "#1E2650", // guard:allow-raw-color — authored slide palette, not app chrome.
  muted: "#51587C", // guard:allow-raw-color — authored slide palette, not app chrome.
  white: "#FFFFFF", // guard:allow-raw-color — authored slide palette, not app chrome.
  coral: "#EF5B3A", // guard:allow-raw-color — authored slide palette, not app chrome.
  teal: "#0E9679", // guard:allow-raw-color — authored slide palette, not app chrome.
  sun: "#FFBC2B", // guard:allow-raw-color — authored slide palette, not app chrome.
  blue: "#3F5BF2", // guard:allow-raw-color — authored slide palette, not app chrome.
};

const TOKENS = `--deck-bg:${C.cream};--deck-ink:${C.navy};--deck-muted:${C.muted};--deck-accent:${C.coral};--deck-surface:${C.white};--deck-heading-font:'Lexend',sans-serif;--deck-body-font:'Nunito',sans-serif;--deck-radius:22px;font-family:'Nunito',sans-serif;`;

const TOTAL = 6;
const H1 = `margin:0;font-family:'Lexend',sans-serif;font-weight:700;color:var(--deck-ink);letter-spacing:-0.03em;`;
const HEAD = `font-family:var(--deck-heading-font);font-weight:600;letter-spacing:-0.02em;`;
const CARD = `background:var(--deck-surface);border-radius:var(--deck-radius);box-shadow:0 2px 0 ${tint(C.navy, 8)},0 10px 24px -12px ${tint(C.navy, 25)};`;

/** Lesson chrome: section chip in the section's color and a progress track. */
const lesson = (
  n: number,
  section: string,
  color: string,
  style: string,
  body: string,
) =>
  bRoot(
    TOKENS,
    `padding:92px 64px 48px;gap:22px;${style}`,
    `<div style="position:absolute;top:32px;left:64px;right:64px;display:flex;justify-content:space-between;align-items:center;">
      <span style="display:inline-flex;align-items:center;gap:10px;font-size:15px;font-weight:700;color:var(--deck-ink);"><span style="width:12px;height:12px;border-radius:50%;background:${color};"></span>${section}<span style="color:var(--deck-muted);font-weight:600;">· Lesson 3.2</span></span>
      <div style="display:flex;gap:6px;">${Array.from({ length: TOTAL }, (_, i) => `<span style="width:28px;height:8px;border-radius:4px;background:${i < n ? color : tint(C.navy, 12)};"></span>`).join("")}</div>
    </div>
    ${body}`,
  );

const badge = (label: string, color: string, size = 40) =>
  `<span style="flex:none;width:${size}px;height:${size}px;border-radius:50%;background:${color};color:${C.white};display:flex;align-items:center;justify-content:center;${HEAD}font-weight:700;font-size:${Math.round(size * 0.45)}px;">${label}</span>`;

const chip = (label: string, color: string) =>
  `<span style="display:inline-flex;align-items:center;gap:10px;padding:10px 16px;border-radius:999px;background:var(--deck-surface);border:2px solid ${color};font-size:16px;font-weight:700;white-space:nowrap;"><span style="width:14px;height:14px;border-radius:50%;background:${color};"></span>${label}</span>`;

const arrow = (color: string) =>
  `<div style="display:flex;align-items:center;width:48px;"><div style="flex:1;height:4px;border-radius:2px;background:${color};"></div><div style="width:14px;height:16px;background:${color};clip-path:polygon(0 0,100% 50%,0 100%);"></div></div>`;

const step = (n: number, color: string, title: string, text: string) => `
  <div style="${CARD}position:relative;padding:22px 20px;display:flex;flex-direction:column;gap:10px;">
    ${badge(String(n), color, 44)}
    <h2 style="margin:4px 0 0;${HEAD}font-size:21px;line-height:1.15;">${title}</h2>
    <p style="margin:0;font-size:16px;line-height:1.45;color:var(--deck-muted);">${text}</p>
  </div>`;

const option = (letter: string, text: string, color: string) =>
  `<div style="${CARD}display:flex;align-items:center;gap:16px;padding:16px 20px;"><span style="flex:none;width:44px;height:44px;border-radius:12px;background:${tint(color, 16)};color:${color};display:flex;align-items:center;justify-content:center;${HEAD}font-weight:700;font-size:21px;">${letter}</span><span style="font-size:21px;font-weight:700;">${text}</span></div>`;

const takeaway = (color: string, title: string, text: string) =>
  `<li style="display:flex;gap:18px;align-items:flex-start;padding:16px 0;border-top:2px dashed ${tint(C.navy, 14)};"><span style="flex:none;width:18px;height:18px;margin-top:4px;border-radius:6px;background:${color};"></span><div><h2 style="margin:0 0 4px;${HEAD}font-size:21px;">${title}</h2><p style="margin:0;font-size:17px;line-height:1.45;color:var(--deck-muted);">${text}</p></div></li>`;

export const LESSON_DECK = bDeck(
  "starter-lesson",
  "Course Lesson",
  "education",
  "A friendly, readable lesson module: learning objectives, a concept diagram, step-by-step process, a quick quiz, and a recap, color-coded by section.",
  [
    [
      "title",
      bRoot(
        TOKENS,
        `padding:64px;flex-direction:row;align-items:center;gap:40px;`,
        `<div style="flex:1;display:flex;flex-direction:column;gap:22px;">
          <span style="align-self:flex-start;padding:8px 14px;border-radius:999px;background:${tint(C.teal, 14)};color:${C.teal};font-size:15px;font-weight:800;">Module 3 · Lesson 2</span>
          <h1 style="${H1}font-size:56px;line-height:1.04;">How plants turn light into food</h1>
          <p style="margin:0;max-width:420px;font-size:20px;line-height:1.5;color:var(--deck-muted);">A 20-minute lesson on photosynthesis: what goes in, what comes out, and why it matters to us.</p>
          <div style="display:flex;gap:10px;font-size:15px;font-weight:700;">
            <span style="padding:8px 14px;border-radius:12px;background:var(--deck-surface);">20 min</span>
            <span style="padding:8px 14px;border-radius:12px;background:var(--deck-surface);">3 activities</span>
            <span style="padding:8px 14px;border-radius:12px;background:var(--deck-surface);">1 quiz</span>
          </div>
        </div>
        <div aria-hidden="true" style="position:relative;width:360px;height:380px;flex:none;">
          <div style="position:absolute;right:10px;top:0;width:170px;height:170px;border-radius:50%;background:${C.sun};box-shadow:0 0 0 22px ${tint(C.sun, 22)};"></div>
          <div style="position:absolute;left:20px;top:110px;width:250px;height:220px;border-radius:0 100% 0 100%;background:${C.teal};"></div>
          <div style="position:absolute;left:44px;top:130px;width:290px;height:4px;border-radius:2px;background:${tint(C.white, 45)};transform:rotate(41deg);transform-origin:left center;"></div>
          <div style="position:absolute;left:36px;top:300px;width:58px;height:58px;border-radius:50% 0 50% 50%;background:${C.blue};transform:rotate(-45deg);"></div>
          <div style="position:absolute;left:0;top:40px;width:36px;height:36px;border-radius:50%;border:4px solid ${C.coral};"></div>
          <div style="position:absolute;left:52px;top:10px;width:18px;height:18px;border-radius:50%;background:${C.coral};"></div>
        </div>`,
      ),
      "Open with a question before showing this slide: where does a tree's mass come from? Let a few students guess. The topic is an example; replace the title, module number, and timings with your own lesson.",
    ],
    [
      "content",
      lesson(
        2,
        "Goals",
        C.blue,
        `flex-direction:row;gap:40px;padding-top:88px;`,
        `<div style="width:300px;flex:none;border-radius:var(--deck-radius);background:${C.blue};color:${C.white};padding:30px 28px;display:flex;flex-direction:column;justify-content:space-between;">
          <h1 style="${H1}color:${C.white};font-size:40px;line-height:1.08;">By the end of this lesson, you can…</h1>
          <p style="margin:0;font-size:17px;line-height:1.45;color:${tint(C.white, 85)};">Check yourself against these at the end. We'll come back to them.</p>
        </div>
        <ol style="list-style:none;margin:0;padding:0;flex:1;display:flex;flex-direction:column;justify-content:center;gap:14px;">
          ${[
            ["Name", "the three things a plant needs to make its own food."],
            ["Explain", "where in the leaf photosynthesis happens."],
            ["Describe", "what the plant releases, and why we depend on it."],
          ]
            .map(
              ([verb, rest], i) =>
                `<li style="${CARD}display:flex;align-items:center;gap:18px;padding:18px 22px;">${badge(String(i + 1), C.blue)}<span style="font-size:20px;line-height:1.4;"><b style="${HEAD}font-weight:700;color:${C.blue};">${verb}</b> ${rest}</span></li>`,
            )
            .join("")}
        </ol>`,
      ),
      "Read the three objectives aloud and ask students to rate their confidence on each from 1 to 3. Replace them with your own; start each with an observable verb so you can check it at the end.",
    ],
    [
      "content",
      lesson(
        3,
        "Learn",
        C.teal,
        ``,
        `<h1 style="${H1}font-size:38px;line-height:1.1;">Plants are tiny sugar factories</h1>
        <div style="display:grid;grid-template-columns:280px 1fr;gap:32px;align-items:center;flex:1;">
          <div style="display:flex;flex-direction:column;gap:16px;">
            <p style="margin:0;font-size:18px;line-height:1.5;">Inside each leaf, chloroplasts use light energy to turn water and carbon dioxide into sugar.</p>
            <div style="border-radius:16px;background:${tint(C.teal, 12)};padding:14px 16px;font-size:16px;line-height:1.45;"><b style="color:${C.teal};">Key word:</b>&nbsp;<b>chlorophyll</b> is the green pigment that absorbs the light.</div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="display:flex;flex-direction:column;gap:12px;">${chip("Sunlight", C.sun)}${chip("Water", C.blue)}${chip("Carbon dioxide", C.muted)}</div>
            ${arrow(C.navy)}
            <div style="width:124px;height:116px;border-radius:0 100% 0 100%;background:${C.teal};color:${C.white};display:flex;align-items:center;justify-content:center;${HEAD}font-weight:700;font-size:18px;">Leaf</div>
            ${arrow(C.navy)}
            <div style="display:flex;flex-direction:column;gap:12px;">${chip("Glucose", C.coral)}${chip("Oxygen", C.teal)}</div>
          </div>
        </div>
        <div style="border-radius:16px;background:var(--deck-surface);border:2px solid ${tint(C.navy, 10)};padding:14px 20px;display:flex;justify-content:center;gap:14px;align-items:baseline;font-size:19px;font-weight:700;">
          <span>carbon dioxide + water</span><span style="color:${C.teal};font-size:15px;">— light →</span><span>glucose + oxygen</span>
        </div>`,
      ),
      "Point to each input, then the leaf, then each output. Ask: which of these can we see, and which are invisible? The word equation at the bottom is the one line students should copy down.",
    ],
    [
      "content",
      lesson(
        4,
        "Learn",
        C.teal,
        ``,
        `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:32px;">
          <h1 style="${H1}font-size:38px;line-height:1.1;">Step by step, inside the chloroplast</h1>
          <p style="margin:0;max-width:250px;font-size:16px;line-height:1.45;color:var(--deck-muted);">The same four steps happen in every green leaf, every sunny day.</p>
        </div>
        <div style="position:relative;margin:auto 0;display:grid;grid-template-columns:repeat(4,1fr);gap:16px;align-items:stretch;padding-top:10px;">
          <div style="position:absolute;left:40px;right:40px;top:54px;height:0;border-top:3px dashed ${tint(C.navy, 22)};"></div>
          ${step(1, C.sun, "Capture light", "Chlorophyll absorbs sunlight, mostly red and blue light.")}
          ${step(2, C.blue, "Split water", "That energy splits water, releasing oxygen as a by-product.")}
          ${step(3, C.teal, "Store energy", "The energy is held briefly in carrier molecules.")}
          ${step(4, C.coral, "Build sugar", "Carbon dioxide from the air is built into glucose.")}
        </div>`,
      ),
      "Go one card at a time. After step 2, ask where the oxygen we breathe comes from. Keep the colors consistent with the inputs on the previous slide so students can link them.",
    ],
    [
      "content",
      lesson(
        5,
        "Check",
        C.coral,
        ``,
        `<h1 style="${H1}font-size:24px;line-height:1.2;color:${C.coral};">Check your understanding</h1>
        <p style="margin:-8px 0 4px;font-family:var(--deck-heading-font);font-weight:600;font-size:32px;line-height:1.25;letter-spacing:-0.02em;max-width:760px;">Which gas do plants release into the air during photosynthesis?</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          ${option("A", "Carbon dioxide", C.blue)}
          ${option("B", "Oxygen", C.teal)}
          ${option("C", "Nitrogen", C.sun)}
          ${option("D", "Hydrogen", C.coral)}
        </div>
        <div style="margin-top:auto;display:flex;align-items:center;gap:12px;font-size:17px;color:var(--deck-muted);"><span style="padding:6px 12px;border-radius:999px;background:${tint(C.coral, 14)};color:${C.coral};font-weight:800;font-size:15px;">Hint</span>Think back to step 2. Discuss with a partner for 30 seconds, then vote.</div>`,
      ),
      "Answer: B, oxygen. Give 30 seconds of partner talk, then have everyone vote at once with fingers (1 to 4) so nobody copies. If many choose A, revisit the inputs and outputs on slide 3.",
    ],
    [
      "content",
      lesson(
        6,
        "Recap",
        C.sun,
        `flex-direction:row;gap:36px;`,
        `<div style="flex:1;display:flex;flex-direction:column;gap:8px;">
          <h1 style="${H1}font-size:38px;line-height:1.1;margin-bottom:6px;">Three things to remember</h1>
          <ul style="list-style:none;margin:0;padding:0;">
            ${takeaway(C.sun, "Light is the energy source", "Chlorophyll captures it inside the chloroplasts.")}
            ${takeaway(C.blue, "Water and carbon dioxide go in", "Roots bring water; leaves take in carbon dioxide.")}
            ${takeaway(C.teal, "Glucose and oxygen come out", "The plant uses the sugar; we breathe the oxygen.")}
          </ul>
        </div>
        <div style="width:270px;flex:none;align-self:stretch;border-radius:var(--deck-radius);background:var(--deck-ink);color:${C.white};padding:26px 24px;display:flex;flex-direction:column;justify-content:space-between;">
          <div style="display:flex;flex-direction:column;gap:10px;">
            <span style="font-size:15px;font-weight:800;color:${C.sun};">Next lesson</span>
            <h2 style="margin:0;${HEAD}font-size:26px;line-height:1.15;">How cells release energy</h2>
          </div>
          <div style="border-top:1px solid ${tint(C.white, 25)};padding-top:14px;font-size:16px;line-height:1.45;color:${tint(C.white, 85)};"><b style="color:${C.white};">Before then:</b> find one plant at home and note where it gets its light.</div>
        </div>`,
      ),
      "Ask students to revisit the three objectives from slide 2 and re-rate their confidence. Replace the next-lesson card and the homework prompt with your own sequence.",
    ],
  ],
);
