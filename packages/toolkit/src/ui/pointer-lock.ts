export function afterBodyPointerUnlock(callback: () => void) {
  const run = () => {
    if (document.body.style.pointerEvents === "none") {
      window.requestAnimationFrame(run);
      return;
    }
    callback();
  };
  window.requestAnimationFrame(run);
}
