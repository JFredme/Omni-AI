import { positionBetween } from "@/lib/ordering";

type Positioned = { id: string; position: number; createdAt: string };

export function sortByPosition<T extends Positioned>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * Works out where a dragged card lands. `column` is the target column in display order (it may contain the
 * dragged card) and `targetIndex` is the gap the pointer was over, counted in that list (0 = above the first card).
 * `unchanged` is true when the card would end up exactly where it already is.
 */
export function planDrop(column: Positioned[], draggedId: string, targetIndex: number): { position: number; unchanged: boolean } {
  const draggedIndex = column.findIndex((task) => task.id === draggedId);
  const index = targetIndex - (draggedIndex !== -1 && draggedIndex < targetIndex ? 1 : 0);
  const others = column.filter((task) => task.id !== draggedId);
  return {
    position: positionBetween(others[index - 1]?.position ?? null, others[index]?.position ?? null),
    unchanged: draggedIndex !== -1 && draggedIndex === index,
  };
}

/** The position that puts a card at the end of a column. */
export function endPosition(column: Pick<Positioned, "position">[]): number {
  return positionBetween(column.at(-1)?.position ?? null, null);
}
