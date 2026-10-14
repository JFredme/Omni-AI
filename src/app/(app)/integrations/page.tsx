import type { Metadata } from "next";
import { Suspense } from "react";
import { IntegrationsWorkspace } from "@/components/integrations/integrations-workspace";

export const metadata: Metadata = { title: "Integrations" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <IntegrationsWorkspace />
    </Suspense>
  );
}
