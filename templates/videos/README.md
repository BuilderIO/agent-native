# Video

An agent-native, Remotion-based video composition studio. Describe a video in
plain English and the agent generates animated React compositions with camera
moves, interactive cursor animations, and a full timeline editor.

**Live app: [videos.agent-native.com](https://videos.agent-native.com)**

Compositions are code-driven and yours to own. Generate with AI or build manually
with the same track system, then refine keyframes, easing, and cursor
interactions on the timeline.

## Features

- Describe videos in natural language and get React components + animation tracks.
- Camera system with animatable translate, scale, rotate, and perspective.
- Interactive cursor with hover/click detection and component-type interactions.
- Advanced timeline: multi-keyframe editing, easing curves, and view ranges.
- Built-in components: kinetic text, logo reveal/explode, slideshows, and more.
- Standardized 1920×1080 @ 30fps compositions.

## Develop locally

Scaffold your own copy and run it:

```bash
npx @agent-native/core@latest create my-videos --standalone --template videos
cd my-videos
pnpm install
pnpm dev
```

Full docs: [agent-native.com/docs/template-videos](https://agent-native.com/docs/template-videos).
