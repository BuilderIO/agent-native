import { useParams, useMatch, Outlet } from "react-router";
import { SprintPage } from "@/pages/SprintPage";

export default function SprintRoute() {
  const { boardId } = useParams();
  const isExact = useMatch("/sprint/:boardId");
  if (!isExact) return <Outlet />;
  return <SprintPage boardId={boardId!} />;
}
