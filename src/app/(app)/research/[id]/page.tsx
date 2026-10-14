import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportPage } from "@/components/research/report-page";

export const metadata: Metadata = { title: "Research report" };

async function Loaded({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReportPage id={id} />;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div aria-hidden className="h-64 animate-pulse rounded-lg bg-muted" />}>
      <Loaded params={params} />
    </Suspense>
  );
}
