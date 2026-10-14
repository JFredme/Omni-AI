import type { Metadata } from "next";
import { Suspense } from "react";
import { ProjectDashboard } from "@/components/projects/project-dashboard";
import { SkeletonRows } from "@/components/ui/states";

export const metadata: Metadata = {
  title: "Project",
};

async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectDashboard id={id} />;
}

// `params` is read inside the Suspense boundary so the page shell doesn't depend on the URL.
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<SkeletonRows count={3} />}>
      <ProjectPage params={params} />
    </Suspense>
  );
}
