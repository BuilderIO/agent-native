// ProseMirror's test for `Mod`, so a hint names the key its shortcut listens
// for.
export const isApplePlatform = () =>
  typeof navigator !== "undefined" &&
  /Mac|iP(hone|[oa]d)/.test(navigator.platform);
