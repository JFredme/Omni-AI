import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelPicker, matchesFilter, matchesQuery } from "@/components/model-picker";
import { normalizeModel, type CatalogModel } from "@/lib/openrouter/models";

const models: CatalogModel[] = [
  normalizeModel({
    id: "acme/free-mini",
    name: "Free Mini",
    pricing: { prompt: "0", completion: "0" },
    architecture: { input_modalities: ["text"] },
  }),
  normalizeModel({
    id: "acme/pro-vision",
    name: "Pro Vision",
    pricing: { prompt: "0.000003", completion: "0.000015" },
    architecture: { input_modalities: ["text", "image"] },
    supported_parameters: ["tools", "response_format"],
    context_length: 200000,
  }),
] as CatalogModel[];

describe("model filters", () => {
  it("filters by price, favorites, and capabilities", () => {
    const [free, paid] = models;
    expect(matchesFilter(free, "free", [])).toBe(true);
    expect(matchesFilter(paid, "free", [])).toBe(false);
    expect(matchesFilter(paid, "favorites", ["acme/pro-vision"])).toBe(true);
    expect(matchesFilter(paid, "images", [])).toBe(true);
    expect(matchesFilter(free, "images", [])).toBe(false);
    expect(matchesFilter(paid, "tools", [])).toBe(true);
    expect(matchesFilter(paid, "json", [])).toBe(true);
    expect(matchesFilter(paid, "reasoning", [])).toBe(false);
  });

  it("requires every search term to match name, id, or description", () => {
    expect(matchesQuery(models[1], "pro vision")).toBe(true);
    expect(matchesQuery(models[1], "pro free")).toBe(false);
    expect(matchesQuery(models[0], "  ")).toBe(true);
  });
});

describe("ModelPicker", () => {
  function renderPicker(overrides: Partial<Parameters<typeof ModelPicker>[0]> = {}) {
    const props = {
      models,
      value: "acme/free-mini",
      favoriteIds: [] as string[],
      onSelect: vi.fn(),
      onToggleFavorite: vi.fn(),
      ...overrides,
    };
    render(<ModelPicker {...props} />);
    return { props, user: userEvent.setup() };
  }

  it("shows the selected model and opens the list", async () => {
    const { user } = renderPicker();
    await user.click(screen.getByRole("button", { name: /Free Mini/ }));
    expect(screen.getByRole("listbox", { name: "Models" })).toBeTruthy();
  });

  it("filters the list with the search box and filter chips", async () => {
    const { user } = renderPicker();
    await user.click(screen.getByRole("button", { name: /Free Mini/ }));
    const list = screen.getByRole("listbox", { name: "Models" });
    expect(within(list).getAllByRole("option")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Paid" }));
    expect(within(list).getAllByRole("option").map((option) => option.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Pro Vision")]),
    );
    expect(within(list).queryByText("Free Mini")).toBeNull();

    await user.click(screen.getByRole("button", { name: "All" }));
    await user.type(screen.getByRole("searchbox", { name: "Search models" }), "mini");
    expect(within(list).getAllByRole("option")).toHaveLength(1);
  });

  it("selects a model and closes", async () => {
    const { user, props } = renderPicker();
    await user.click(screen.getByRole("button", { name: /Free Mini/ }));
    await user.click(within(screen.getByRole("listbox", { name: "Models" })).getByText("Pro Vision"));
    expect(props.onSelect).toHaveBeenCalledWith("acme/pro-vision");
    expect(screen.queryByRole("dialog", { name: "Choose a model" })).toBeNull();
  });

  it("toggles favorites without selecting the model", async () => {
    const { user, props } = renderPicker({ favoriteIds: [] });
    await user.click(screen.getByRole("button", { name: /Free Mini/ }));
    await user.click(screen.getByRole("button", { name: "Add Pro Vision to favorites" }));
    expect(props.onToggleFavorite).toHaveBeenCalledWith("acme/pro-vision");
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("shows the load error instead of an empty list", async () => {
    const { user } = renderPicker({ models: [], value: null, loadError: "Invalid key" });
    await user.click(screen.getByRole("button", { name: /Choose a model/ }));
    expect(screen.getByText("Invalid key")).toBeTruthy();
  });
});
