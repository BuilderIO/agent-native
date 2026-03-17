// @agent-native/pinpoint — Media element freeze (video, audio, SVG SMIL)
// MIT License

/**
 * Pause all playing media elements on the page.
 * Returns a cleanup function to resume.
 */
export function freezeMedia(): () => void {
  const mediaElements = document.querySelectorAll("video, audio");
  const playing: HTMLMediaElement[] = [];

  mediaElements.forEach((el) => {
    const media = el as HTMLMediaElement;
    if (!media.paused) {
      media.pause();
      playing.push(media);
    }
  });

  // Pause SVG SMIL animations
  const svgElements = document.querySelectorAll("svg");
  const pausedSVGs: SVGSVGElement[] = [];
  svgElements.forEach((svg) => {
    if (typeof svg.pauseAnimations === "function") {
      try {
        svg.pauseAnimations();
        pausedSVGs.push(svg);
      } catch {
        // SVG may not support animation
      }
    }
  });

  return () => {
    playing.forEach((media) => {
      try {
        media.play();
      } catch {
        // Media may have been removed
      }
    });

    pausedSVGs.forEach((svg) => {
      try {
        svg.unpauseAnimations();
      } catch {
        // SVG may have been removed
      }
    });
  };
}
