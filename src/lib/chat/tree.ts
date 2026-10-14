/**
 * Messages form a tree: each replies to a parent, and editing a message or regenerating a reply adds a sibling
 * instead of replacing anything. The conversation shows one path from the root down to a "leaf".
 */

export interface TreeNode {
  id: string;
  parentId: string | null;
  createdAt: Date | number;
}

const time = (node: TreeNode) => (node.createdAt instanceof Date ? node.createdAt.getTime() : node.createdAt);
const byAge = (a: TreeNode, b: TreeNode) => time(a) - time(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The messages from the first one down to `id`, oldest first. Stops safely if the data contains a loop. */
export function pathTo<T extends TreeNode>(nodes: T[], id: string | null): T[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const path: T[] = [];
  const seen = new Set<string>();
  let cursor = id ? byId.get(id) : undefined;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    path.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return path.reverse();
}

/** The path shown for a conversation: down to its saved leaf, or to the newest message if none is saved. */
export function activePath<T extends TreeNode>(nodes: T[], leafId: string | null): T[] {
  if (nodes.length === 0) return [];
  const leaf = leafId && nodes.some((node) => node.id === leafId) ? leafId : [...nodes].sort(byAge).at(-1)!.id;
  return pathTo(nodes, leaf);
}

/** Messages that reply to the same parent (including this one), oldest first. */
export function siblingsOf<T extends TreeNode>(nodes: T[], node: T): T[] {
  return nodes.filter((other) => other.parentId === node.parentId).sort(byAge);
}

/** From `startId`, keeps following the newest reply until a message has none. Returns that last message's id. */
export function deepestLatest(nodes: TreeNode[], startId: string): string {
  const children = new Map<string | null, TreeNode[]>();
  for (const node of nodes) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  let current = startId;
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(current)) return current;
    seen.add(current);
    const next = (children.get(current) ?? []).sort(byAge).at(-1);
    if (!next) return current;
    current = next.id;
  }
}
