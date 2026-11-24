import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  estimatePotassiumMg,
  kNaRatio,
  mainIngredients,
  parseNutritionPanel,
  parseServingSize,
  servingGrams,
  sumNutrients,
} from "../nutrition";

const fixture = (f: string) => readFileSync(path.join(__dirname, "../../../fixtures", f), "utf8");

describe("parseNutritionPanel", () => {
  it("parses the dining hall's label-then-value layout", () => {
    const p = parseNutritionPanel(fixture("panel-bbq-baked-chicken.txt"));
    expect(p).toEqual({
      servingSize: "100 gram",
      servingAmount: 100,
      servingUnit: "g",
      calories: 160,
      fatG: 8,
      satFatG: 2.5,
      transFatG: 0,
      cholesterolMg: 55,
      sodiumMg: 540,
      carbsG: 3,
      fiberG: 0,
      sugarsG: 2,
      proteinG: 17,
      ingredients: "Chicken pieces, Sauce bbq, Montreal chicken seasoning",
    });
  });

  it("parses one-line 'Label value' layout too", () => {
    const p = parseNutritionPanel("Serving Size: 118 mL\nCalories 210\nSodium 480 mg\nProtein: 9 g");
    expect(p.servingAmount).toBe(118);
    expect(p.servingUnit).toBe("ml");
    expect(p.calories).toBe(210);
    expect(p.sodiumMg).toBe(480);
    expect(p.proteinG).toBe(9);
  });

  it("treats '<1 g' as half", () => {
    expect(parseNutritionPanel("Protein\n<1 g").proteinG).toBe(0.5);
  });
});

describe("serving size + potassium", () => {
  it("parses fractions and units", () => {
    expect(parseServingSize("1/2 cup")).toEqual({ amount: 0.5, unit: "cup" });
    expect(parseServingSize("1 each")).toEqual({ amount: 1, unit: "each" });
    expect(parseServingSize("4 oz")).toEqual({ amount: 4, unit: "oz" });
  });

  it("estimates K from mg/100 g and serving grams", () => {
    expect(servingGrams(100, "g")).toBe(100);
    expect(servingGrams(118, "ml")).toBe(118);
    expect(servingGrams(1, "each")).toBeNull();
    // roast chicken ~ 223 mg/100 g
    expect(estimatePotassiumMg(223, 100)).toBe(223);
    expect(estimatePotassiumMg(223, 150)).toBe(335);
  });

  it("takes the first ingredients without sub-lists", () => {
    expect(mainIngredients("Chicken pieces, Sauce bbq (tomato, sugar, salt), Montreal chicken seasoning")).toEqual([
      "chicken pieces",
      "sauce bbq",
    ]);
  });
});

describe("totals", () => {
  it("sums and computes K:Na", () => {
    const t = sumNutrients([
      { proteinG: 17, sodiumMg: 540, potassiumMg: 223, calories: 160 },
      { proteinG: 1.3, sodiumMg: 1, potassiumMg: 422, calories: 105 },
    ]);
    expect(t).toEqual({ proteinG: 18.3, sodiumMg: 541, potassiumMg: 645, calories: 265 });
    expect(kNaRatio(3400, 2300)).toBe(1.48);
    expect(kNaRatio(100, 0)).toBeNull();
  });
});
