
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
        void media.play();
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
