export const menuIconClass = "size-4 shrink-0 text-muted-foreground";

// Escape should close a menu within a frame; the shared close animation
// alone takes 100 ms. Its `animate-out` outranks a plain `animate-none`.
export const instantCloseMenuClass = "data-[state=closed]:!animate-none";
