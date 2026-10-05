# Measuring Figma

Figma parity claims from memory are wrong often enough to be worthless. Measure:

1. Add a **new page** in the file (`Add new page` button) so you never disturb
   existing work.
2. Build the minimal case there.
3. Read the layers tree from `[role="row"][data-testid^="layer-row"]`.
4. Read geometry from the inspector inputs (`X-position`, `Y-position`, …).

**Inspector X/Y is parent-relative for auto-layout children and absolute for
top-level nodes.** Arithmetic on it silently targets empty canvas — use
`locateOnCanvas` (probe-and-confirm) instead.

Worked example that settled a real question — "does Figma reverse auto-layout
children in the layers panel?":

```
3 loose texts laid out left→right Alpha Bravo Charlie
  panel: Charlie Bravo Alpha        <- paint order, newest on top
select all, Shift+A (wrap in auto layout)
  panel: Alpha Bravo Charlie        <- Figma RE-SORTS into layout order
  and each child's inspector X confirms it: Alpha=0, Bravo=260, Charlie=520
```

Names alone would have been suggestive; the X readings made it conclusive.

If Figma genuinely has no counterpart to the interaction, say so explicitly
and why; do not silently skip it.

## Refreshing the Figma login

A Fusion branch logs Figma in from the `FIGMA_COOKIES_B64` project secret. The
login expires after a few weeks; the doctor prints the date and warns a week
ahead. To refresh it (macOS shown):

1. Start Chrome with its own profile and a debugging port:
   `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir="$HOME/.cache/figma-export-profile"`
2. Log in to Figma there with the account the branches should use.
3. From the repo root:
   `node .agents/skills/design-clip-repro/scripts/export-figma-cookies.mjs | pbcopy`
4. Paste it into the project's `FIGMA_COOKIES_B64` and start a new branch.

The value is a live login: keep it in the secret, never in a file, chat or
commit. Close that window instead of logging out, which ends the session. The
same window is the "your Chrome on :9222" the skill uses on your machine.
