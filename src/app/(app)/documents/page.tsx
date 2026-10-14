import type { Metadata } from "next";
import { DocumentsWorkspace } from "@/components/documents/documents-workspace";

export const metadata: Metadata = { title: "Documents" };

export default function Page() {
  return <DocumentsWorkspace />;
}
