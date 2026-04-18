import { Outlet } from "react-router";
import { LibraryLayout } from "@/components/library/library-layout";

export default function AppLayoutRoute() {
  return (
    <LibraryLayout>
      <Outlet />
    </LibraryLayout>
  );
}
