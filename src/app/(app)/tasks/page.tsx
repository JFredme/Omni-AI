import type { Metadata } from "next";
import { TasksWorkspace } from "@/components/tasks/tasks-workspace";

export const metadata: Metadata = {
  title: "Tasks",
};

export default function Page() {
  return <TasksWorkspace />;
}
