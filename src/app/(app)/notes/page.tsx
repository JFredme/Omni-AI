import type { Metadata } from "next";
import { NotesWorkspace } from "@/components/notes/notes-workspace";

export const metadata: Metadata = {
  title: "Notes",
};

export default function Page() {
  return <NotesWorkspace initialId={null} />;
}
