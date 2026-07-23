import { TaskListPage } from "@/components/tasks/TaskListPage";
import messages from "@/i18n/en-US";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [
    { title: `${messages.tasks.pageTitle} · ${APP_TITLE}` },
    {
      name: "description",
      content:
        "Manage tasks, reorder by drag-and-drop, and ask chat to add or update reminders.",
    },
  ];
}

export default function TasksRoute() {
  return <TaskListPage />;
}
