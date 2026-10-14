import type { Metadata } from "next";
import { ProjectsWorkspace } from "@/components/projects/projects-workspace";

export const metadata: Metadata = {
  title: "Projects",
};

export default function Page() {
  return <ProjectsWorkspace />;
}
