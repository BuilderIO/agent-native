const BUILDER_CDN_HOST_RE = /^cdn(?:-qa)?\.builder\.io$/i;

export function isBuilderCdnHost(hostname: string): boolean {
  return BUILDER_CDN_HOST_RE.test(hostname);
}
