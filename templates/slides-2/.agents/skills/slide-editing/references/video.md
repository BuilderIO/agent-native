# Video

Slides 2 videos use uploaded MP4 or WebM assets. In the visual editor, upload a
video from the asset browser, then insert it or replace the selected video.
Uploads are limited to 50 MB. For agent-authored source, call `list-assets`
with `media: "video"` (or `media: "all"`) and use the returned `assetId` as an
`asset://` handle. When selecting media for an existing deck, include its
`deckId` with global scope so results are limited to assets the deck can use.
`list-assets` defaults to images. A video poster must also use an uploaded image
asset handle.

Generated slides store canonical React in `sourceTsx`; do not add HTTPS media
URLs or edit generated slides through legacy HTML fields. Read the source with
`get-slide-source`, then save with `update-slide-source` using its current
`revision` and `sourceHash`. Preserve an existing `data-slide-object-id` when
replacing a video, then read the source again to verify the save.

```tsx
export default function Slide() {
  return (
    <div style={{ position: "relative", width: "1280px", height: "720px" }}>
      <video
        src={"asset://uploaded-video-id"}
        poster={"asset://uploaded-image-id"}
        controls
        playsInline
        preload="metadata"
        data-slide-object-id="video-1"
        style={{
          position: "absolute",
          left: "320px",
          top: "180px",
          width: "320px",
          height: "180px",
          objectFit: "contain",
        }}
      />
    </div>
  );
}
```

`autoPlay`, `muted`, and `loop` are supported static video attributes. Use
`muted` and `playsInline` with `autoPlay` to meet common browser playback
policies. Verify the target export before claiming it preserves playable video.
