// navigator.clipboard is missing or rejects in an iframe that wasn't granted
// clipboard-write (the preview host is one), so fall back to the legacy
// selection-based copy instead of silently doing nothing there.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // coercion-ok: permission/availability failure, retried via execCommand
  }

  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.top = "0";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  field.setSelectionRange(0, text.length);
  try {
    return document.execCommand("copy");
  } catch {
    // coercion-ok: false is the copy-failed signal the caller already branches on
    return false;
  } finally {
    field.remove();
  }
}
