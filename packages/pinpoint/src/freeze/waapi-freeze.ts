// @agent-native/pinpoint — Web Animations API freeze
// MIT License

/**
 * Pause all WAAPI animations on the page.
 * Returns a cleanup function to resume.
 */
export function freezeWAAPI(): () => void {
  const animations = document.getAnimations();
  const playing = animations.filter((a) => a.playState === "running");
  playing.forEach((a) => a.pause());

  return () => {
    playing.forEach((a) => {
      try {
        a.play();
      } catch {
        // Animation may have been removed
      }
    });
  };
}
