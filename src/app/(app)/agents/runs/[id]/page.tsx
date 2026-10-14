import type { Metadata } from "next";
import { Suspense } from "react";
import { RunView } from "@/components/agents/run-view";
import { SkeletonRows } from "@/components/ui/states";

export const metadata: Metadata = {
  title: "Agent run",
};

async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RunView id={id} />;
}

// `params` is read inside the Suspense boundary so the page shell doesn't depend on the URL.
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<SkeletonRows count={3} />}>
      <RunPage params={params} />
    </Suspense>
  );
}
