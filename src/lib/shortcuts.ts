export interface ShortcutDefinition {
  /** "mod" is replaced with ⌘ on Apple platforms and Ctrl elsewhere. */
  keys: string[];
  label: string;
}

export const shortcuts: ShortcutDefinition[] = [
  { keys: ["mod", "K"], label: "Open the command palette" },
  { keys: ["mod", "B"], label: "Collapse or expand the sidebar" },
  { keys: ["mod", ","], label: "Open settings" },
  { keys: ["↑", "↓"], label: "Move through palette results" },
  { keys: ["Enter"], label: "Run the highlighted command" },
  { keys: ["Esc"], label: "Close the palette or navigation menu" },
];
