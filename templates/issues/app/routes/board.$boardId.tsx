import { useParams } from "react-router";
import { BoardPage } from "@/pages/BoardPage";

export default function BoardRoute() {
  const { boardId } = useParams();
  return <BoardPage boardId={boardId!} />;
}
