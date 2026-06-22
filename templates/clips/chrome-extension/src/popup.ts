const CLIPS_RECORD_URL = "https://clips.agent-native.com/record";

function newSessionId(): string {
  return crypto.randomUUID();
}

function buildRecordUrl(): string {
  const url = new URL(CLIPS_RECORD_URL);
  url.searchParams.set("clipsExtensionId", chrome.runtime.id);
  url.searchParams.set("clipsCaptureSessionId", newSessionId());
  return url.toString();
}

document.getElementById("record")?.addEventListener("click", () => {
  void chrome.tabs.create({ url: buildRecordUrl() });
  window.close();
});
