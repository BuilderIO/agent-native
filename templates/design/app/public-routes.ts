export function isPublicDesignAppPath(pathname: string): boolean {
  return (
    pathname === "/visual-edit" ||
    pathname === "/design" ||
    pathname.startsWith("/design/") ||
    pathname.startsWith("/present/")
  );
}
