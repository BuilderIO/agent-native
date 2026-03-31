import { useParams } from "react-router";
import { SprintPage } from "@/pages/SprintPage";

export default function SprintRoute() {
  const { boardId } = useParams();
  return <SprintPage boardId={boardId!} />;
}
