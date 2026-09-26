
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
