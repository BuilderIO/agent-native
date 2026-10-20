# Performance clips

When the clip is about lag rather than behaviour:

- **Profile the unfixed behaviour on production**, on the production copy from
  `copy-design.mjs`: `openEditor(prodCopyId, { prod: true })` logs in as the
  test account on `https://beta.design.agent-native.com` (`DESIGN_PROD_BASE`
  overrides it). The deployed app is a production
  build, so its profile is real. Do not build a production bundle in the
  container: it is slow and heavy, and the dev server's numbers are dominated
  by React's `jsxDEV`.
- **Measure the fix relatively.** The fix only exists on this branch's dev
  server, so profile the same steps there before and after your change and
  compare those two runs with each other, never with production numbers.
- **Reproduce on the design from the clip, not a toy one.** Most real costs
  scale with the screen's size; a one-element design shows none of them.
- **Report main-thread long-task time per interaction**, with the production
  baseline and the relative change on the dev server.
