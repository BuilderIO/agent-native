---
name: audio
description: Using audio and sound in Remotion - importing, trimming, volume, speed, pitch
metadata:
  tags: audio, media, trim, volume, speed, loop, pitch, mute, sound, sfx
---

# Using audio in Remotion

## Prerequisites

The @remotion/media package needs to be installed:

```bash
pnpm exec remotion add @remotion/media
```

## Importing Audio

```tsx
import { Audio } from "@remotion/media";
import { staticFile } from "remotion";

export const MyComposition = () => {
  return <Audio src={staticFile("audio.mp3")} />;
};
```

## Trimming

```tsx
const { fps } = useVideoConfig();
<Audio
  src={staticFile("audio.mp3")}
  trimBefore={2 * fps}
  trimAfter={10 * fps}
/>;
```

## Volume

Static: `<Audio volume={0.5} />`

Dynamic:

```tsx
<Audio
  volume={(f) =>
    interpolate(f, [0, 1 * fps], [0, 1], { extrapolateRight: "clamp" })
  }
/>
```

## Speed, Looping, Pitch

- `playbackRate={2}` for 2x speed
- `loop` for looping
- `toneFrequency={1.5}` for higher pitch (server-side rendering only)
