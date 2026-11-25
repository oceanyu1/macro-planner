import type { itemKindEnum } from "@/db/schema";

export type ItemKind = (typeof itemKindEnum.enumValues)[number];

/**
 * Classify a dish for the planner from MyDiningHub's `master_recipe_type`
 * ("Bake", "Rice", "Vegetables - Green", "Brownie/Bar", ...) and its name.
 * Entrées (bakes, stews, tacos, sandwiches) count as "protein". The first
 * matching rule wins, so the name overrides come first.
 */
const NAME_RULES: [RegExp, ItemKind][] = [
  [/^SIDE, VEGETABLE\b/i, "vegetable"],
  [/^SIDE, (RICE|POTATO|NOODLES?|PASTA|QUINOA|COUSCOUS)\b/i, "starch"],
  [/\b(YOGURT|MILK|COTTAGE CHEESE)\b/i, "dairy"],
  [/\bTOFU\b/i, "protein"], // MTO tofu is filed under "Fruit/Vegetable/Herb/Salad (MTO)"
];

const TYPE_RULES: [RegExp, ItemKind][] = [
  [/cookie|brownie|\bbar\b|\bcake|\bpies?\b|\btarts?\b|pastry|cobbler|crisp|pudding|custard|dessert|quick bread|biscuit|donut|doughnut|frozen|ice cream/i, "dessert"],
  [/smoothie|beverage|juice|coffee|tea\b|shake/i, "beverage"],
  [/spread|gravy|dressing|salsa|relish|pickle|condiment|sauce/i, "condiment"],
  [/^vegetables\b|salad/i, "vegetable"],
  [/^fresh fruit|fruit\b(?!.*vegetable)/i, "fruit"],
  [/^fruit\/vegetable/i, "vegetable"],
  [/rice|potato|pasta|noodle|grain|bread|unleavened|cereal|pancake|waffle|french toast|^cooked$|^dry$/i, "starch"],
  [/protein|meat|poultry|fish|seafood|egg|omelet|quiche|frittata|legume|bake|grill|roast|stew|curry|braise|stir.?fry|taco|wrap|pita|panini|sandwich|burger|filling|casserole/i, "protein"],
];

export function classifyKind(recipeType: string | null | undefined, name: string): ItemKind {
  for (const [re, kind] of NAME_RULES) if (re.test(name)) return kind;
  const t = (recipeType ?? "").trim();
  if (t) for (const [re, kind] of TYPE_RULES) if (re.test(t)) return kind;
  return "other";
}
