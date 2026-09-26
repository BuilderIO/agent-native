import { groupRuntimeBridgeScript } from "../.generated/bridge/group-runtime.generated";

export const GROUP_RUNTIME_ATTR = "data-agent-native-group-runtime";
export const GROUP_RUNTIME_VERSION = "2";
export const GROUP_RUNTIME_SOURCE: string = groupRuntimeBridgeScript;
export const MEASURED_FLOW_GROUP_ATTR = "data-agent-native-measured-flow-group";

export function buildGroupRuntimeScriptTag(): string {
  return `<script ${GROUP_RUNTIME_ATTR} data-runtime-version="${GROUP_RUNTIME_VERSION}">\n${GROUP_RUNTIME_SOURCE}\n</script>`;
}

const GROUP_RUNTIME_RE = new RegExp(
  `<script\\s+${GROUP_RUNTIME_ATTR}[^>]*>[\\s\\S]*?<\\/script\\s*>`,
  "gi",
);

export function ensureGroupRuntime(html: string): string {
  if (!html.includes(MEASURED_FLOW_GROUP_ATTR)) return html;
  const tag = buildGroupRuntimeScriptTag();
  let replaced = false;
  const withCurrentRuntime = html.replace(GROUP_RUNTIME_RE, () => {
    if (replaced) return "";
    replaced = true;
    return tag;
  });
  if (replaced) return withCurrentRuntime;
  const bodyClose = html.toLowerCase().lastIndexOf("</body>");
  if (bodyClose !== -1)
    return `${html.slice(0, bodyClose)}${tag}\n${html.slice(bodyClose)}`;
  const htmlClose = html.toLowerCase().lastIndexOf("</html>");
  if (htmlClose !== -1)
    return `${html.slice(0, htmlClose)}${tag}\n${html.slice(htmlClose)}`;
  return `${html}\n${tag}\n`;
}
