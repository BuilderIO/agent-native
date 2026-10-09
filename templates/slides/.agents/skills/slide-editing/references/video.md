# Video

Slides renders video from MP4 and WebM sources. Prefer dropping a video file on
the slide so it is uploaded to configured file storage and inserted as a
positioned `<video>` object. Uploads are limited to 50 MB. For agent edits, use
`update-slide` and preserve the video's `data-slide-object-id`:

```html
<video
  src="https://files.example.com/video.mp4"
  controls
  playsinline
  preload="metadata"
  data-slide-object-id="video-1"
  style="position:absolute;left:320px;top:180px;width:320px;height:180px;object-fit:contain;"
></video>
```

Videos play on click by default. Set `autoplay` to start playback when the
presentation reaches the slide; autoplay is muted and inline to satisfy browser
playback policies. Add `loop` to repeat. Editor thumbnails and PDF rendering
keep autoplay disabled. Verify the target export before claiming that it
preserves playable video.
