// @agent-native/pinpoint — Open file in editor
// MIT License

/**
 * Open a file in the user's editor. Tries vscode:// protocol first,
 * falls back to a fetch to /api/open-file.
 */
export async function openFile(
  filePath: string,
  lineNumber?: number,
): Promise<void> {
  const vsCodeUrl = lineNumber
    ? `vscode://file/${filePath}:${lineNumber}`
    : `vscode://file/${filePath}`;

  try {
    window.open(vsCodeUrl, "_blank");
    return;
  } catch {
    // VS Code not available
  }

  try {
    await fetch("/api/open-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath, lineNumber }),
    });
  } catch {
    console.warn("[pinpoint] Could not open file:", filePath);
  }
}
