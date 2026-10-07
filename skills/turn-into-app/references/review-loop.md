# Screenshot review loop

## Contents

- Setup
- The script
- Procedure
- Rubric
- Fixing
- Host notes

Run this in step 5, inside the app directory, after the dev server answers
200 and `.env` holds `AUTH_DISABLED=1` (the run and deploy guide). The skill
asks for this review explicitly, so it overrides any instruction against
writing a browser script for checks. Any browser tool that can set the
viewport, emulate light and dark, and take screenshots can stand in for the
script; the loop is the contract, not the tool.

## Setup

Once per app, from the app directory (`.tmp/` is gitignored in the scaffold;
the first line makes sure):

```bash
grep -qxF '.tmp/' .gitignore || echo '.tmp/' >> .gitignore
mkdir -p .tmp/ui-review && (cd .tmp/ui-review && npm init -y >/dev/null && npm i playwright@latest)
```

The script uses the installed Google Chrome first and falls back to
Playwright's bundled Chromium. If neither is installed, run
`(cd .tmp/ui-review && npx playwright install chromium)`, which downloads a
browser; say so when you run it.

Write the script below to `.tmp/ui-review/shoot.mjs`. Run it on the root URL,
never on the route, so the redirect to `app.homePath` is tested; pass a pass
name, a selector for the main agent control, and the domain route:

```bash
node .tmp/ui-review/shoot.mjs http://localhost:<port>/ p1 'button:has-text("<agent verb>")' /<route>
```

## The script

```js
// shoot.mjs <url> [pass] [clickSelector] [expectRoute]; writes PNGs and metrics next to this file, in out/
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [url, pass = "p1", click, expect] = process.argv.slice(2);
if (!url)
  throw new Error(
    "usage: node shoot.mjs <url> [pass] [clickSelector] [expectRoute]",
  );
const out = join(dirname(fileURLToPath(import.meta.url)), "out");
mkdirSync(out, { recursive: true });
const browser = await chromium
  .launch({ channel: "chrome" })
  .catch(() => chromium.launch());

async function open(width, height, colorScheme) {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme,
  });
  const page = await context.newPage();
  const errors = [];
  page.on(
    "console",
    (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)),
  );
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  // A cold dev server compiles the route on first hit; not networkidle: live sync keeps a connection open.
  await page.goto(url, { waitUntil: "load", timeout: 120000 });
  // Settle: the URL unchanged for 1.5 s (the / -> homePath redirect), at most 20 s.
  let last = "",
    stable = 0;
  for (let i = 0; i < 40 && stable < 3; i++) {
    await page.waitForTimeout(500);
    const busy = await page
      .evaluate(() =>
        /dev server is restarting/i.test(document.body?.innerText ?? ""),
      )
      .catch(() => true);
    stable = !busy && page.url() === last ? stable + 1 : 0;
    last = page.url();
  }
  return { context, page, errors };
}

function metrics(expect) {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top < innerHeight;
  };
  const q = (s) => [...document.querySelectorAll(s)].filter(vis);
  const cs = (el) => getComputedStyle(el);
  const text = document.body.innerText;
  const leaves = q("p,li,div,span,pre,code").filter(
    (el) => !el.children.length && el.textContent.trim(),
  );
  const chrome = leaves.filter((el) => !el.closest("[data-content]"));
  const eyebrows = leaves.filter((el) => {
    const s = cs(el);
    return (
      s.textTransform === "uppercase" &&
      parseFloat(s.letterSpacing) > 0.5 &&
      parseFloat(s.fontSize) <= 13
    );
  });
  const stepNums = q('[role="tab"]')
    .map(
      (t) =>
        /^(?:step\s*)?(\d+)(?!\d|\s*(?:[dhmwy%]|days?|hours?|weeks?|months?|years?)\b)/i.exec(
          t.textContent.trim(),
        )?.[1],
    )
    .filter(Boolean)
    .map(Number);
  const primary = cs(document.documentElement)
    .getPropertyValue("--primary")
    .trim();
  const boxes = [...document.querySelectorAll("body *")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  });
  const ownText = (el) =>
    [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  let headerOverlap = 0;
  for (const header of document.querySelectorAll("header")) {
    const hr = [...header.querySelectorAll("*")]
      .filter((e) => !e.children.length && e.textContent.trim() && vis(e))
      .map((e) => e.getBoundingClientRect());
    for (let i = 0; i < hr.length; i++)
      for (let j = i + 1; j < hr.length; j++)
        if (
          hr[i].left < hr[j].right - 1 &&
          hr[j].left < hr[i].right - 1 &&
          hr[i].top < hr[j].bottom - 1 &&
          hr[j].top < hr[i].bottom - 1
        )
          headerOverlap++;
  }
  return {
    path: location.pathname,
    landed: expect
      ? location.pathname === expect ||
        location.pathname.startsWith(expect + "/")
      : null,
    signedOut: /continue as local dev|sign in to your account/i.test(text),
    overflowX: document.documentElement.scrollWidth > innerWidth + 1,
    proseWords: chrome
      .map((el) => el.textContent.trim().split(/\s+/).length)
      .filter((n) => n >= 8)
      .reduce((a, n) => a + n, 0),
    stepper:
      (stepNums.includes(1) && stepNums.includes(2)) ||
      q('[aria-current="step"]').length > 0 ||
      /step \d+ of \d+/i.test(text),
    textareasAboveFold: q("textarea").length,
    visuals: q(
      "svg[viewBox]:not([class*=tabler]),canvas,img,table,[role=grid],[data-visual]",
    ).length,
    eyebrows: eyebrows.length,
    h1s: q("h1").length,
    tinyTargets: q("button,a[href],input,select,[role=button]").filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width < 24 || r.height < 24;
    }).length,
    defaultTokens: ["0 0% 15%", "0 0% 75%"].includes(primary),
    neutralPrimary: !(parseFloat(primary.split(/\s+/)[1]) >= 20),
    rawMarkdown: leaves.filter((el) =>
      /(^|\n)\s*#{1,4} \S|\*\*\S[^*\n]*\*\*/.test(el.textContent),
    ).length,
    clipped: boxes.filter(
      (el) =>
        ownText(el) &&
        el.scrollWidth > el.clientWidth + 1 &&
        ["hidden", "clip"].includes(cs(el).overflowX) &&
        cs(el).textOverflow !== "ellipsis",
    ).length,
    innerScroll: boxes.filter(
      (el) =>
        ["auto", "scroll"].includes(cs(el).overflowX) &&
        el.scrollWidth > el.clientWidth + 1,
    ).length,
    headerOverlap,
  };
}

const rows = [];
for (const [w, h, tag] of [
  [1440, 900, "desktop"],
  [390, 844, "mobile"],
]) {
  for (const scheme of ["light", "dark"]) {
    const { context, page, errors } = await open(w, h, scheme);
    await page.screenshot({ path: join(out, `${pass}-${tag}-${scheme}.png`) });
    rows.push({
      viewport: `${w}x${h}`,
      scheme,
      errors,
      ...(await page.evaluate(metrics, expect ? expect : null)),
    });
    if (tag === "desktop" && scheme === "light") {
      await page.addStyleTag({
        content: "html { filter: grayscale(1) blur(3px); }",
      });
      await page.screenshot({ path: join(out, `${pass}-squint.png`) });
    }
    await context.close();
  }
}
if (click) {
  // A fresh context, after the viewport shots, so the click cannot leak into them.
  const { context, page } = await open(1440, 900, "light");
  await page
    .locator(click)
    .first()
    .click({ timeout: 5000 })
    .catch((e) => console.log("click failed:", String(e).split("\n")[0]));
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, `${pass}-click-400ms.png`) });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: join(out, `${pass}-click-5s.png`) });
  await context.close();
}
await browser.close();
writeFileSync(join(out, `${pass}-metrics.json`), JSON.stringify(rows, null, 2));
console.table(
  rows.map(({ errors, ...r }) => ({ ...r, errors: errors.length })),
);
```

Output in `.tmp/ui-review/out/`: `<pass>-desktop-light.png`,
`<pass>-desktop-dark.png`, `<pass>-mobile-light.png`, `<pass>-mobile-dark.png`,
`<pass>-squint.png` (desktop light, grayscale and blurred),
`<pass>-click-400ms.png` (the working state, agent sidebar open),
`<pass>-click-5s.png` (the result, or the run or setup card), and
`<pass>-metrics.json`.

Reading the metrics:

- `signedOut` true or `landed` false means the pass is invalid. Sign-in: add
  `AUTH_DISABLED=1` (run and deploy guide). `landed` false: `/` did not open
  the domain route, so fix `app.homePath` and restart the server; `path`
  shows where it went.
- `proseWords` counts chrome text only. Wrap record text, table cells, and
  document body in `data-content`; wrapping titles, helper text, or empty
  states is cheating and shows in the diff.
- `stepper` reads tab labels; a range switch (7d, 30d) is not a stepper, and
  a stepper drawn without tabs still fails when you see one in the shot.
- `innerScroll` counts horizontally scrolling containers; at 390px each one
  must be a board lane scroller or a filter row (look at the shot).
- `tinyTargets` is a floor (24px); the rule is 40px, or 44px on touch.
- The scaffold logs React's "Encountered a script tag" error once or twice
  per page, and chat routes also log one 404 for a thread that does not exist
  yet. Ignore exactly those messages, matched by text, not by count; any other
  console error counts. A "Dev server is restarting" page and its 503 errors
  are not a pass: poll for 200 and shoot again.

## Procedure

1. Shoot pass `p1` with the command above.
2. On p1 open all seven PNGs; on later passes open the shots whose criteria
   failed. Before scoring, write one line per image: what a stranger sees
   first, and what is clipped, cramped, or empty. In the squint shot the main
   object and its verb must still be identifiable, and status must survive
   without color.
3. Write `.tmp/ui-review/critique-pN.md`. On p1 start with a table of at least
   three defects (image, region, defect, fix); a p1 critique without it is
   invalid even when every score is 4 or higher. Later passes list the defects
   you can see. Then the rubric: per row a score and its evidence (a quoted
   string, a count, or a region). A score with no evidence counts as 3. Check
   the automatic fails first.
4. Caps: an automatic fail caps criteria 1, 2, and 4 at 2. At most three
   criteria score 5, each backed by a measurable ("visuals 4, chrome words 31").
5. Installed design skills (`impeccable`, `better-ui`, `frontend-design`) are
   optional: at most one `polish` or `audit` pass on the p1 shots while time
   remains. Skip any step that asks the user or sets up a new direction
   (`init`, `shape`, `critique`), and drop any suggestion that removes
   populated data, per-object agent verbs, or the direction's tokens.
6. Fix every finding in one batch; do not hunt micro-issues between passes.
   The click is real: reset what it changed (Retry, Clear, or the sample-data
   reset) so the next pass and the delivered app open on the sample state.
7. Shoot `p2` and rescore. Shoot `p3` only to clear an automatic fail, then
   stop: two passes by default, three at most. Use the script as written;
   do not grow a separate test harness.
8. The bar (defaults): mean 4.0 or higher, no criterion below 3, no automatic
   fail. On the final pass, if the host can spawn a sub-agent and time
   remains, give it only the PNGs, the rubric, and the brief, have it score
   blind, and keep the lower score per row.
9. Put the final table, the metrics, and the absolute paths of the final
   pass's screenshots in the final report, and name any open criterion. Never
   report a passed review without screenshots.

## Rubric

| #   | Criterion             | 5 means                                                                                           | 3 means                                                                                  | 1 means                                             |
| --- | --------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1   | First-viewport impact | Domain objects fill most of the view, populated, with one clear verb                              | Domain objects fill about half; the rest is whitespace or chrome                         | Mostly whitespace, a form, or text                  |
| 2   | Domain fit            | The layout has the shape of the user's real objects                                               | Right objects, generic layout (a list of cards)                                          | A generic card stack                                |
| 3   | Hierarchy             | The squint shot shows primary, secondary, tertiary                                                | Two levels read; the third is noise                                                      | Everything has equal weight                         |
| 4   | Chrome discipline     | No repeated titles, subtitles, strips, or helper text                                             | One redundant title, strip, or helper line                                               | Eyebrow, H1, subtitle, nested cards                 |
| 5   | Sample data           | 12+ varied, believable records with edge cases; numbers agree                                     | Real but thin data (6-10 rows), few edge cases                                           | Empty, lorem, "Item 1"                              |
| 6   | Typography            | Clear scale, tabular numbers, comfortable measure, formatted long text                            | Scale exists; numbers not tabular or measure too wide                                    | One size, default stack, raw markdown               |
| 7   | Color and direction   | A named direction in tokens; accent only on action, selection, state                              | Tokens applied; accent also used as decoration                                           | Scaffold grey or mixed accents                      |
| 8   | Polish                | Concentric radii, shadow rings, 40px targets, hover, press, focus                                 | Some states or radii mismatched                                                          | Default controls, no states                         |
| 9   | Agent and UI together | The click shows a working state on the object; the result lands in place with Accept, Edit, Retry | Working state on the page, but the result lands elsewhere or without Accept, Edit, Retry | Chat is elsewhere; the UI stays static              |
| 10  | 390px                 | A purposeful mobile layout, an obvious path to detail, 44px targets                               | Usable, but one clipped control or a 32px target                                         | Overflow, clipped controls, or no way to the detail |
| 11  | Dark mode             | A designed palette; charts and status legible                                                     | Themed, but one pill, chart, or image is wrong                                           | Broken or unthemed                                  |
| 12  | Accessibility         | Roles, visible focus, 4.5:1 text, status not by color alone                                       | Roles and focus present; one color-only status or low-contrast text                      | Div buttons, no focus ring                          |

Automatic fails, whatever the mean:

- `signedOut` true (the pass does not count: fix sign-in and shoot again);
- `stepper` true, or a stepper or wizard as the shell;
- `/` not opening the domain route (`landed` false);
- an empty first viewport, an empty state as the home, or a form-only first
  viewport (`textareasAboveFold` above 0 with `visuals` at 0) on a source that
  is not A11 or A12; an A11 or A12 home needs a filled sample input beside a
  populated result, history, or entries list;
- chrome text over 60 words (`proseWords`);
- `defaultTokens` true, or `neutralPrimary` true on an unbranded app;
- `overflowX` at 390px; `clipped` or `headerOverlap` above 0 on any row;
  `innerScroll` at 390px that is not a lane scroller or filter row;
- `rawMarkdown` above 0;
- a console error from the new route;
- a hit from either grep in Fixing.

Criterion 9 needs a connected AI provider to show a result landing. Without
one, judge the working state in the 400 ms shot and the "Connect AI" path in
the 5 s shot, and say in the final report that the result was not exercised.

## Fixing

Most defects are one of these:

- Delete chrome before restyling: page titles, subtitles, eyebrows, strips,
  and a heading under the header title that names the view again.
- Make the domain object bigger and the form smaller; move inputs behind an
  Add verb or into the agent composer, unless the source is A11 or A12.
- Replace placeholder rows with sample records that include edge cases.
- Apply the direction's tokens. If `defaultTokens` is true, the block did not
  load: check that it was appended after the scaffold's and that `--primary`
  changed.
- Check the working state: the 400 ms shot must show the object busy, and the
  5 s shot must not show it stuck.
- Run both commands before every pass; each must print nothing. The first
  lists raw colors (the scaffold's `root.tsx` theme-color hex is excluded),
  the second forbidden icons:

```bash
grep -rnE '\b(bg|text|border|ring|fill|stroke|from|to|via|divide)-(white|black|(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-[0-9]{2,3})?)\b|#[0-9a-fA-F]{6}\b' app --include='*.tsx' --exclude-dir=ui --exclude=root.tsx
grep -rnE 'Icon(Sparkles|Wand|Magic|Robot)' app --include='*.tsx'
```

## Host notes

- **Claude Code, Codex, Cursor:** run the script from the terminal. A browser
  tool the host provides (a browser MCP, a built-in browser, a preview pane)
  works too, if it sets the viewport and color scheme. Open the PNGs with the
  host's image viewing to score them.
- **Agent-Native agent in a code session:** the same script, from the app
  directory.
- **Offline, or the install is denied:** use the host's browser tool;
  otherwise a one-shot capture, `"<chrome path>" --headless=new
--window-size=1440,900 --screenshot=.tmp/ui-review/out/p1-desktop-light.png
<url>` (no dark mode, no click, no metrics), and say what was not covered.
- **No image viewing:** score only from the metrics, mark each rubric row
  "not scored", and say so in the final report.
- **No shell or browser at all:** skip the loop, and say in the final report
  that no screenshots were reviewed. Never report scores without screenshots.
- **Browser hosts:** no review here; the Dispatch handoff carries the design
  decisions, and the status stays pending or unverified.
