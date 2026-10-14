import type { Metadata } from "next";
import { Suspense } from "react";
import { NotesWorkspace } from "@/components/notes/notes-workspace";
import { SkeletonRows } from "@/components/ui/states";

export const metadata: Metadata = {
  title: "Notes",
};

async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NotesWorkspace initialId={id} />;
}

// `params` is read inside the Suspense boundary so the page shell doesn't depend on the URL.
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<SkeletonRows count={3} />}>
      <NotePage params={params} />
    </Suspense>
  );
}
