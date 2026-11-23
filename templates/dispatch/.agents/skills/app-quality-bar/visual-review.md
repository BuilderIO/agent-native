# Visual review

Capture signed-in desktop and 390 px shots in light and dark mode, a
downsampled grayscale shot for hierarchy, and the primary interaction at
400 ms and at completion or 5 s. Capture the app's mounted root and check it
opens the intended domain screen. For extensions, capture the actual host
slot or route. Take shots from a repeatable, populated fixture.

Record defects with screenshot region, evidence, and the fix. Score every
row from 1 to 5. Use 2 and 4 for intermediate cases and attach evidence to
each score. On the final pass, give an independent reviewer only the shots,
this rubric, and the brief. Keep the lower score for each row. Require mean
4.0 or higher, every row at least 3, and zero automatic fails.

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
  is not an input-first tool or logbook. Those need a filled sample input
  beside a populated result, history, or entries list;
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
  Add verb or into the agent composer, unless the main surface is an input-first tool or logbook.
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
