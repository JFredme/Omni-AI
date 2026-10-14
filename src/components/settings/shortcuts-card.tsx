import { ShortcutKeys } from "@/components/shortcut-keys";
import { Card } from "@/components/ui/card";
import { shortcuts } from "@/lib/shortcuts";

export function ShortcutsCard() {
  return (
    <Card id="shortcuts" className="scroll-mt-20 space-y-4">
      <div>
        <h2 className="font-semibold">Keyboard shortcuts</h2>
        <p className="text-sm text-muted-foreground">Available on every page.</p>
      </div>
      <ul className="divide-y divide-border">
        {shortcuts.map((shortcut) => (
          <li key={shortcut.label} className="flex items-center justify-between gap-4 py-2.5">
            <span className="text-sm">{shortcut.label}</span>
            <ShortcutKeys keys={shortcut.keys} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
