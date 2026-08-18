/**
 * Embedded app hosts own the Agent Native session. Hide the app-side SSO
 * affordance while leaving the app's ordinary sign-in and signup controls
 * available for the first login.
 */
export const HIDE_EMBEDDED_IDENTITY_SSO_SCRIPT = `(() => {
  const selector = "#identity-sso-btn";
  const styleId = "agent-native-embedded-auth-ui";
  const removeIdentitySsoButton = () => {
    for (const element of document.querySelectorAll(selector)) {
      element.remove();
    }
  };
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = selector + " { display: none !important; }";
    (document.head || document.documentElement).appendChild(style);
  }
  removeIdentitySsoButton();
  if (typeof MutationObserver === "function" && document.documentElement) {
    const observer = new MutationObserver(removeIdentitySsoButton);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("unload", () => observer.disconnect(), { once: true });
  }
  return true;
})()`;
