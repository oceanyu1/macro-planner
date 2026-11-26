import { describe, expect, it } from "vitest";
import {
  autoMatch,
  cnfByCode,
  cnfFoods,
  firstIngredient,
  KNOWN_MATCHES,
  potassiumKey,
  searchCnf,
  servingPotassium,
  suggestCnf,
} from "../potassium";

const top = (name: string, kind: string, ingredients: string | null = null) => suggestCnf({ name, kind, ingredients }, 1)[0];

describe("CNF table", () => {
  it("is loaded and sane", () => {
    const foods = cnfFoods();
    expect(foods.length).toBeGreaterThan(5000);
    const broccoli = foods.find((f) => f.name === "Broccoli, boiled, drained");
    expect(broccoli?.mgPer100g).toBe(293);
    expect(foods.every((f) => f.mgPer100g >= 0 && f.mgPer100g < 20000)).toBe(true);
  });
});

describe("potassiumKey / firstIngredient", () => {
  it("normalises menu names to a reusable key", () => {
    expect(potassiumKey("MTO PTN YOGURT, GREEK, PLAIN (2 OZ VOL)")).toBe("yogurt, greek, plain");
    expect(potassiumKey("MTO PTN SUNFLOWER SEEDS (30 ML)")).toBe("sunflower seeds");
    expect(potassiumKey("Herbes de Provence Salmon")).toBe("herbes de provence salmon");
  });

  it("skips water, oil and salt to find the real first ingredient", () => {
    expect(firstIngredient("Water, Rice, white, Salt")).toBe("rice");
    expect(firstIngredient("Salmon (Pink salmon, Water). Contains: Fish")).toBe("salmon");
    expect(firstIngredient(null)).toBeNull();
  });
});

describe("suggestCnf", () => {
  it.each([
    ["White Rice", "starch", "Water, Rice", /^Grains, rice, white, .*cooked/],
    ["Brown Rice", "starch", null, /^Grains, rice, brown, .*cooked/],
    ["Broccoli", "vegetable", null, /^Broccoli, boiled/],
    ["Egg White", "protein", "Eggs", /^Egg, chicken, white/],
    ["Hard Cooked Egg", "protein", "Eggs", /^Egg, chicken, whole, cooked/],
    ["Herbes de Provence Salmon", "protein", "Salmon (Pink salmon)", /salmon/i],
    ["Grilled Chicken", "protein", "Chicken thigh", /^Chicken, broiler/],
    ["Spring Mix", "vegetable", "Spring salad mix", /^Lettuce, spring mix/],
    ["Green Beans", "vegetable", "Green beans", /^Beans, snap/],
    ["Penne", "starch", "Water, Penne", /^Pasta, .*cooked/],
    ["Oatmeal", "starch", "Water, Oats", /oats/i],
    ["Grapefruit", "fruit", null, /^Grapefruit, .*raw/],
    ["Black Olives", "vegetable", "Olives", /^Olive/],
    ["Yogurt, Greek, Plain", "dairy", "Yogurt", /^Yogourt, Greek/],
    ["Beef Vindaloo", "protein", "Beef", /^Beef, /],
  ])("%s → %s", (name, kind, ingredients, expected) => {
    expect(top(name, kind, ingredients)?.name).toMatch(expected);
  });

  it("never suggests organ meats for a plain meat dish", () => {
    for (const n of ["Beef Stroganoff", "Honey Garlic Chicken", "Togarashi Chicken"]) {
      for (const s of suggestCnf({ name: n, kind: "protein" }, 3)) {
        expect(s.name, n).not.toMatch(/liver|heart|lung|kidney|feet|brain|tongue|gizzard/i);
      }
    }
  });

  it("prefers cooked over dry/uncooked grains", () => {
    expect(top("Quinoa", "starch")?.name).toMatch(/cooked/);
  });

  it("returns nothing for an empty name", () => {
    expect(suggestCnf({ name: "", kind: null })).toEqual([]);
  });
});

describe("autoMatch", () => {
  it("every hand-checked match points at a real CNF food", () => {
    for (const [key, code] of Object.entries(KNOWN_MATCHES)) {
      expect(cnfByCode(code), key).toBeDefined();
      expect(potassiumKey(key), `${key} must already be a normalised key`).toBe(key);
    }
  });

  it("uses hand-checked matches over the scorer", () => {
    expect(autoMatch({ name: "Blondie", kind: "dessert", ingredients: "Soy flour" })?.name).toMatch(/brownie/i);
    expect(autoMatch({ name: "Salsa", kind: "condiment" })?.name).toBe("Sauce, salsa, ready-to-serve");
  });

  it("leaves potassium unknown rather than guessing badly", () => {
    expect(autoMatch({ name: "Chef's Daily Special", kind: "other", ingredients: null })).toBeNull();
  });

  it("matches a served potato, not potato skin", () => {
    expect(autoMatch({ name: "Rosemary Potato Wedges", kind: "starch", ingredients: "Potatoes" })?.name).not.toMatch(/skin, baked$/);
  });

  it("doesn't turn corn into corn pasta", () => {
    expect(autoMatch({ name: "Corn", kind: "vegetable" })?.name).toMatch(/^Corn, sweet/);
  });
});

describe("searchCnf", () => {
  it("finds foods containing every word, shortest first", () => {
    const r = searchCnf("chicken breast roasted");
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((f) => /chicken/i.test(f.name) && /breast/i.test(f.name) && /roasted/i.test(f.name))).toBe(true);
  });
});

describe("servingPotassium", () => {
  it("scales mg per 100 g by the serving weight (1 mL ≈ 1 g)", () => {
    expect(servingPotassium(293, 118, "ml")).toBe(346);
    expect(servingPotassium(35, 0.5, "cup")).toBe(42);
  });
  it("is unknown without a match or a weighable serving", () => {
    expect(servingPotassium(null, 100, "g")).toBeNull();
    expect(servingPotassium(150, 1, "each")).toBeNull();
  });
});
