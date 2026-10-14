import { describe, expect, it } from "vitest";
import { MAX_RENDERED_CHARS, placeholdersIn, renderTemplate, type TemplateContext } from "./template";

const context: TemplateContext = {
  trigger: { title: "Buy milk", tags: ["home", "food"], nested: { count: 3 } },
  steps: { "1": { output: "first result" }, "2": { output: { ok: true } } },
  today: "2026-03-01",
  now: "2026-03-01T08:00:00.000Z",
};

describe("renderTemplate", () => {
  it("fills in trigger fields, step outputs, and dates", () => {
    expect(renderTemplate("Task: {{trigger.title}} on {{today}}", context)).toBe("Task: Buy milk on 2026-03-01");
    expect(renderTemplate("{{steps.1.output}} / {{ steps.1.output }}", context)).toBe("first result / first result");
    expect(renderTemplate("{{trigger.nested.count}} items at {{now}}", context)).toBe("3 items at 2026-03-01T08:00:00.000Z");
  });

  it("joins lists of text with new lines and writes other values as JSON", () => {
    expect(renderTemplate("{{trigger.tags}}", context)).toBe("home\nfood");
    expect(renderTemplate("{{steps.2.output}}", context)).toBe('{"ok":true}');
  });

  it("uses an empty string for anything missing", () => {
    expect(renderTemplate("[{{trigger.missing}}][{{steps.9.output}}][{{nothing}}]", context)).toBe("[][][]");
  });

  it("can't reach into prototypes or run code", () => {
    expect(renderTemplate("{{trigger.constructor}}{{trigger.__proto__}}{{steps.constructor.name}}", context)).toBe("");
    expect(renderTemplate("{{ 1+1 }} {{trigger.title()}} ${trigger.title}", context)).toBe("{{ 1+1 }} {{trigger.title()}} ${trigger.title}");
  });

  it("doesn't re-expand placeholders found inside inserted text", () => {
    const tricky: TemplateContext = { ...context, trigger: { title: "{{steps.1.output}}" } };
    expect(renderTemplate("{{trigger.title}}", tricky)).toBe("{{steps.1.output}}");
  });

  it("caps how long the result can be", () => {
    const big: TemplateContext = { ...context, trigger: { title: "x".repeat(MAX_RENDERED_CHARS * 2) } };
    expect(renderTemplate("{{trigger.title}}", big)).toHaveLength(MAX_RENDERED_CHARS);
  });

  it("lists placeholders", () => {
    expect(placeholdersIn("a {{trigger.title}} b {{ steps.1.output }}")).toEqual(["trigger.title", "steps.1.output"]);
  });
});
