/** Spacing between items appended to a list. */
export const POSITION_STEP = 1024;

/**
 * Returns a position that sorts between two neighbours. Pass `null` for "no neighbour" on that side.
 * Used when a card is dropped between two others on the board.
 */
export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return POSITION_STEP;
  if (before === null) return (after as number) - POSITION_STEP;
  if (after === null) return before + POSITION_STEP;
  return (before + after) / 2;
}
