import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyKind } from "../menu/kind";
import { MenuResponseError, parseAllergens, parseLocationRecipes } from "../menu/parse";
import { locationRecipesUrl } from "../menu/api";

const DATE = "2026-11-24";
const load = (f: string) => JSON.parse(readFileSync(path.join(__dirname, "../../../fixtures", f), "utf8"));
const breakfast = parseLocationRecipes(load("location-recipes-2026-11-24-breakfast.json"), DATE);
const lunch = parseLocationRecipes(load("location-recipes-2026-11-24-lunch.json"), DATE);
const dinner = parseLocationRecipes(load("location-recipes-2026-11-24.json"), DATE);

const find = (r: typeof dinner, name: string, serving?: string) =>
  r.items.find((i) => i.name === name && (serving == null || i.servingSize === serving));

describe("parseLocationRecipes", () => {
  it("reads a simple item with full nutrition", () => {
    expect(find(dinner, "Herbes de Provence Salmon")).toMatchObject({
      sourceId: "M74556",
      sku: "277715_116163_M74556_4_29070",
      station: "True Balance",
      kind: "protein",
      servingSize: "50 gram",
      servingAmount: 50,
      servingUnit: "g",
      calories: 62,
      proteinG: 10.1,
      sodiumMg: 266,
      fatG: 2,
      carbsG: 0.4,
      allergens: ["Fish"],
    });
    expect(find(dinner, "Herbes de Provence Salmon")?.ingredients).toMatch(/^Salmon \(Pink salmon/);
  });

  it("splits a configurable item into one row per served serving size", () => {
    const broccoli = dinner.items.filter((i) => i.sourceId === "M501");
    expect(broccoli.map((b) => [b.servingSize, b.proteinG, b.sodiumMg, b.calories]).sort()).toEqual([
      ["118 millilitre", 2.5, 134, 42],
      ["85 millilitre", 1.8, 97, 30],
    ]);
    expect(broccoli.every((b) => b.kind === "vegetable" && b.servingUnit === "ml")).toBe(true);
  });

  it("skips bulk batch sizes and physically impossible nutrition", () => {
    expect(dinner.skipped).toContainEqual(expect.objectContaining({ name: "Grilled Mojo Tofu", reason: "bulk batch size" }));
    expect(find(dinner, "Grilled Mojo Tofu", "1000 gram")).toBeUndefined();
    expect(find(dinner, "Grilled Mojo Tofu", "85 gram")).toBeDefined();
    expect(breakfast.skipped).toContainEqual(
      expect.objectContaining({ name: "VNG Apple Breakfast Muffin", reason: "impossible calories for serving size" }),
    );
    for (const r of [breakfast, lunch, dinner]) {
      expect(r.items.some((i) => i.servingAmount != null && i.servingAmount >= 1000 && i.servingUnit !== "each")).toBe(false);
    }
  });

  it("lists a dish served at two stations once", () => {
    const keys = dinner.items.map((i) => `${i.sourceId}|${i.servingSize}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("only includes SKUs actually placed at a station", () => {
    // The panini is in products.items but not assigned to any station today.
    expect(lunch.items.find((i) => /Panini/.test(i.name))).toBeUndefined();
  });

  it("builds servings from size + fraction when there is no combined string", () => {
    expect(find(lunch, "Cilantro")).toMatchObject({ servingSize: "1/2 teaspoon", servingAmount: 0.5, servingUnit: "tsp" });
  });

  it("keeps lunch and dinner distinct", () => {
    expect(find(lunch, "Honey Garlic Chicken")).toBeDefined();
    expect(find(dinner, "Honey Garlic Chicken")).toBeUndefined();
    expect(find(dinner, "Grilled Chicken")).toBeDefined();
    expect(find(lunch, "Grilled Chicken")).toBeUndefined();
  });

  it("returns nothing for a date the response doesn't cover", () => {
    expect(parseLocationRecipes(load("location-recipes-2026-11-24.json"), "2026-11-25").items).toEqual([]);
  });

  it("throws on GraphQL errors and malformed responses", () => {
    expect(() => parseLocationRecipes({ errors: [{ message: "boom" }] }, DATE)).toThrow(MenuResponseError);
    expect(() => parseLocationRecipes({ data: { getLocationRecipes: null } }, DATE)).toThrow(MenuResponseError);
  });

  it("produces sane values everywhere", () => {
    for (const r of [breakfast, lunch, dinner]) {
      expect(r.items.length).toBeGreaterThan(30);
      for (const i of r.items) {
        expect(i.sourceId).toMatch(/^[A-Z]\d+$/);
        expect(i.servingSize).not.toBe("");
        expect(i.station).not.toMatch(/^Station \d+$/);
        expect(i.proteinG ?? 0).toBeGreaterThanOrEqual(0);
        expect(i.sodiumMg ?? 0).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("classifyKind", () => {
  it.each([
    ["Bake", "CHICKEN, 9 CUT, BAKED, HONEY GARLIC RES", "protein"],
    ["Stew", "CURRY, BEEF, VINDALOO RES", "protein"],
    ["Rice", "SIDE, RICE, BASMATI", "starch"],
    ["Pancakes/Waffles/French Toast", "FRENCH TOAST", "starch"],
    ["Vegetables - Green", "SIDE, VEGETABLE, BROCCOLI, SPEARS (AP)", "vegetable"],
    ["Brownie/Bar", "BAR, APPLE CRUMBLE (SCRATCH) RES", "dessert"],
    ["Cobbler/Crisp", "CRISP, CHERRY (SCRATCH) RES", "dessert"],
    ["QUICK BREADS", "MUFFIN, BLUEBERRY", "dessert"],
    ["Fresh Fruit", "GRAPEFRUIT, HALF", "fruit"],
    ["Salad Dressing", "MTO PTN DRESSING, RANCH (AP) (1 OZ VOL)", "condiment"],
    ["Smoothie", "SMOOTHIE, GREEN", "beverage"],
    ["Fruit/Vegetable/Herb/Salad (MTO)", "MTO PTN TOFU, FIRM, CUBED", "protein"],
    ["Meat/Cheese/Egg/Protein/Nut (MTO)", "MTO PTN YOGURT, VANILLA", "dairy"],
    ["Traditional 16\"", "PIZZA, PEPPERONI", "other"],
    [null, "MYSTERY", "other"],
  ])("%s / %s → %s", (type, name, kind) => {
    expect(classifyKind(type, name)).toBe(kind);
  });
});

describe("parseAllergens", () => {
  it("splits the Contains: list and ignores the 'not available' notice", () => {
    expect(parseAllergens("Contains: Fish, Milk; Wheat.")).toEqual(["Fish", "Milk", "Wheat"]);
    expect(parseAllergens("Contains: ")).toEqual([]);
    expect(parseAllergens("Complete allergen information is not available.")).toEqual([]);
    expect(parseAllergens(null)).toEqual([]);
  });
});

describe("locationRecipesUrl", () => {
  it("matches the request the website sends", () => {
    const sent = new URLSearchParams(
      readFileSync(path.join(__dirname, "../../../fixtures/location-recipes.request.json"), "utf8").trim(),
    );
    const ours = new URL(locationRecipesUrl("2026-11-24", 16)).searchParams;
    expect(ours.get("query")).toBe(sent.get("query"));
    expect(ours.get("operationName")).toBe("getLocationRecipes");
    expect(JSON.parse(ours.get("variables")!)).toEqual(JSON.parse(sent.get("variables")!));
  });
});
