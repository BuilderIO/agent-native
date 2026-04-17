import { Outlet } from "react-router";
import { LibraryLayout } from "@/components/library/library-layout";

// Pathless layout route — keeps the left sidebar + agent chat mounted across
// every library/space/archive/trash navigation. See client-side-routing skill.
export default function AppLayoutRoute() {
  return (
    <LibraryLayout>
      <Outlet />
    </LibraryLayout>
  );
}
