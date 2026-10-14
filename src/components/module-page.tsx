import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { NavItem } from "@/lib/navigation";

export function ModulePage({ item }: { item: NavItem }) {
  return (
    <div className="space-y-6">
      <PageHeader icon={item.icon} title={item.label} description={item.description} />
      <Card className="flex flex-col gap-4 p-6 sm:p-8">
        <div className="flex items-center gap-2">
          <Badge tone="accent">Not built yet</Badge>
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">{item.label} is on the roadmap</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            The route, navigation entry, and command palette shortcut are in place. The feature itself
            isn&apos;t implemented yet, so nothing on this page is functional.
          </p>
        </div>
        <div>
          <Link href="/" className={buttonVariants({ variant: "outline" })}>
            Back to dashboard
          </Link>
        </div>
      </Card>
    </div>
  );
}
