import { ThemeSegmentedControl } from "@/components/theme-toggle";
import { Card } from "@/components/ui/card";

export function AppearanceCard() {
  return (
    <Card className="space-y-4">
      <div>
        <h2 className="font-semibold">Appearance</h2>
        <p className="text-sm text-muted-foreground">
          Choose light or dark, or follow your operating system. Saved in this browser.
        </p>
      </div>
      <ThemeSegmentedControl />
    </Card>
  );
}
