import type { Metadata } from "next";
import { ModulePage } from "@/components/module-page";
import { getNavItem } from "@/lib/navigation";

const item = getNavItem("knowledge");

export const metadata: Metadata = {
  title: item.label,
};

export default function Page() {
  return <ModulePage item={item} />;
}
