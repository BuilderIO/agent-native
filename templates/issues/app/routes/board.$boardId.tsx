import { useParams, useMatch, Outlet } from "react-router";
import { BoardPage } from "@/pages/BoardPage";

export default function BoardRoute() {
  const { boardId } = useParams();
  // Check if we're on the exact path (no child route)
  const isExact = useMatch("/board/:boardId");
  if (!isExact) return <Outlet />;
  return <BoardPage boardId={boardId!} />;
}
