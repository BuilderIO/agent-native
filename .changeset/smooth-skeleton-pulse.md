---
"@agent-native/core": patch
---

Smooth out the skeleton loading animation. Tailwind's stock `animate-pulse`
swings opacity 1 → 0.5 and eases hard into both ends, and skeletons that mount
at different moments never line up — at that amplitude a screen of placeholders
strobes. The shared stylesheet now defines `--animate-pulse` as a calmer
1 → 0.72 breathe, honours `prefers-reduced-motion` globally, and the two
hand-rolled skeleton keyframes reuse it.
