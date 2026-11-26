import { describe, expect, it } from "vitest";
import { dishName, servingLabel } from "../menu/display";

describe("dishName", () => {
  it.each([
    ["MTO PTN YOGURT, GREEK, PLAIN (2 OZ VOL)", "Yogurt, Greek, Plain"],
    ["MTO PTN WOW  BUTTER (1 OZ)", "Wow Butter"],
    ["MTO PTN SUNFLOWER SEEDS (30 ML)", "Sunflower Seeds"],
    ["MTO GRILLED BALSAMIC VEGETABLES", "Grilled Balsamic Vegetables"],
    ["Creamy Scrambled Egg", "Creamy Scrambled Egg"],
    ["Chocolate, Caramel + Pretzel Brownie", "Chocolate, Caramel + Pretzel Brownie"],
    ["Herbes de Provence Salmon", "Herbes de Provence Salmon"],
  ])("%s → %s", (raw, pretty) => {
    expect(dishName(raw)).toBe(pretty);
  });
});

describe("servingLabel", () => {
  it.each([
    ["118 millilitre", "118 mL"],
    ["155 gram", "155 g"],
    ["1 kilogram", "1 kg"],
    ["1/2 teaspoon", "1/2 tsp"],
    ["2 slice", "2 slice"],
    ["1 each", "1 each"],
  ])("%s → %s", (raw, pretty) => {
    expect(servingLabel(raw)).toBe(pretty);
  });
});
