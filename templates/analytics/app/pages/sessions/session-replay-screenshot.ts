export async function downloadReplayScreenshot(
  iframe: HTMLIFrameElement,
  filename: string,
): Promise<void> {
  const replayWindow = iframe.contentWindow;
  const replayDocument = iframe.contentDocument;
  if (!replayWindow || !replayDocument?.documentElement) {
    throw new Error("Replay frame is unavailable");
  }

  await replayDocument.fonts?.ready;
  await new Promise<void>((resolve) => {
    replayWindow.requestAnimationFrame(() =>
      replayWindow.requestAnimationFrame(() => resolve()),
    );
  });

  const { default: html2canvas } = await import("html2canvas");
  const width = replayWindow.innerWidth;
  const height = replayWindow.innerHeight;
  if (width <= 0 || height <= 0) throw new Error("Replay frame has no size");

  const canvas = await html2canvas(replayDocument.documentElement, {
    allowTaint: false,
    backgroundColor: null,
    height,
    logging: false,
    scale: 1,
    scrollX: replayWindow.scrollX,
    scrollY: replayWindow.scrollY,
    useCORS: true,
    width,
    windowHeight: height,
    windowWidth: width,
  });
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("Replay screenshot could not be encoded"));
    }, "image/png");
  });

  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = filename;
  link.href = downloadUrl;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}
