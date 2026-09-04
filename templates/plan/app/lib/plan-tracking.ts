export function shouldCapturePlanContent(pathname: string): boolean {
  return !(pathname === "/local-plans" || pathname.startsWith("/local-plans/"));
}
