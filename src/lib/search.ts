/**
 * Escapes the characters that are special in a SQL LIKE pattern (`%`, `_`, and the escape character `\`), so a
 * search for "100%" finds "100%" instead of matching everything. Prisma's `contains` does not do this itself.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
