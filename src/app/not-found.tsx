import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="app-backdrop flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">This page doesn&apos;t exist</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The link may be outdated, or the page may have moved.
      </p>
      <Link href="/" className={buttonVariants({ variant: "primary" })}>
        Back to dashboard
      </Link>
    </div>
  );
}
