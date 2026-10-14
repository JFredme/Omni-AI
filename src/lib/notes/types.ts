export interface NoteSummaryDto {
  id: string;
  title: string;
  excerpt: string;
  tags: string[];
  pinned: boolean;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteDto extends NoteSummaryDto {
  content: string;
}

export interface FolderDto {
  id: string;
  name: string;
  noteCount: number;
}

export interface NotesMeta {
  folders: FolderDto[];
  tags: { tag: string; count: number }[];
  total: number;
  unfiled: number;
}

export interface NoteFilters {
  q?: string;
  /** A folder id, or "none" for notes outside every folder. */
  folderId?: string;
  tag?: string;
}
