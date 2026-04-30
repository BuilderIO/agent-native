import { useParams, useMatch, Outlet } from "react-router";
import { SprintPage } from "@/pages/SprintPage";

export function meta() {
  return [{ title: "Sprint — Issues" }];
}

export default function SprintRoute() {
  const { boardId } = useParams();
  const isExact = useMatch("/sprint/:boardId");
  if (!isExact) return <Outlet />;
  return <SprintPage boardId={boardId!} />;
}
