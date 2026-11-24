import {
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const modeEnum = pgEnum("mode", ["home", "dining"]);
export const mealEnum = pgEnum("meal", ["breakfast", "lunch", "dinner", "snack"]);
export const gymEnum = pgEnum("gym", ["upper", "lower"]);
export const logSourceEnum = pgEnum("log_source", ["plan", "swap", "manual", "template"]);
export const kSourceEnum = pgEnum("k_source", ["cnf", "manual", "llm"]);
export const itemKindEnum = pgEnum("item_kind", [
  "protein",
  "vegetable",
  "starch",
  "fruit",
  "dairy",
  "dessert",
  "beverage",
  "condiment",
  "other",
]);

export type MealName = (typeof mealEnum.enumValues)[number];
export type Mode = (typeof modeEnum.enumValues)[number];
export type Gym = (typeof gymEnum.enumValues)[number];

export type ProteinSplit = Record<MealName, number>;

/** One row. `mode` is the home/dining switch the cron checks. */
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  mode: modeEnum("mode").notNull().default("home"),
  proteinTargetG: integer("protein_target_g").notNull().default(140),
  calorieTarget: integer("calorie_target").notNull().default(1750),
  calorieTolerance: integer("calorie_tolerance").notNull().default(100),
  sodiumCapMg: integer("sodium_cap_mg").notNull().default(2300),
  potassiumGoalMg: integer("potassium_goal_mg").notNull().default(3400),
  proteinSplit: jsonb("protein_split")
    .$type<ProteinSplit>()
    .notNull()
    .default({ breakfast: 30, lunch: 45, dinner: 45, snack: 20 }),
  blockedFoods: text("blocked_foods").array().notNull().default(["pork", "tofu"]),
  preferredStations: text("preferred_stations").array().notNull().default([]),
  waterGoalMl: integer("water_goal_ml").notNull().default(3000),
  neckSetsGoal: integer("neck_sets_goal").notNull().default(3),
  gymPerWeek: integer("gym_per_week").notNull().default(4),
  leetcodeGoal: integer("leetcode_goal").notNull().default(1),
  tretinoinStart: date("tretinoin_start"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per dish + serving size; reused across the menu cycle. */
export const menuItem = pgTable(
  "menu_item",
  {
    id: serial("id").primaryKey(),
    sourceId: text("source_id").notNull(),
    name: text("name").notNull(),
    station: text("station"),
    kind: itemKindEnum("kind"),
    servingSize: text("serving_size").notNull(), // as printed, e.g. "100 gram"
    servingAmount: real("serving_amount"), // 100
    servingUnit: text("serving_unit"), // "g" | "ml" | "oz" | "each" ...
    calories: integer("calories"),
    fatG: real("fat_g"),
    satFatG: real("sat_fat_g"),
    transFatG: real("trans_fat_g"),
    cholesterolMg: integer("cholesterol_mg"),
    sodiumMg: integer("sodium_mg"),
    carbsG: real("carbs_g"),
    fiberG: real("fiber_g"),
    sugarsG: real("sugars_g"),
    proteinG: real("protein_g"),
    ingredients: text("ingredients"),
    allergens: text("allergens").array(),
    kMgEst: integer("k_mg_est"),
    kSource: kSourceEnum("k_source"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("menu_item_source_serving_uq").on(t.sourceId, t.servingSize)],
);

/** What is served when. */
export const menuDay = pgTable(
  "menu_day",
  {
    id: serial("id").primaryKey(),
    date: date("date").notNull(),
    meal: mealEnum("meal").notNull(),
    station: text("station"),
    menuItemId: integer("menu_item_id")
      .notNull()
      .references(() => menuItem.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("menu_day_uq").on(t.date, t.meal, t.menuItemId)],
);

/** Ingredient → Canadian Nutrient File food, looked up once. */
export const kMapping = pgTable("k_mapping", {
  id: serial("id").primaryKey(),
  ingredientText: text("ingredient_text").notNull().unique(),
  foodCode: integer("food_code"),
  foodName: text("food_name"),
  mgPer100g: real("mg_per_100g"),
  confirmed: boolean("confirmed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlanItem = { itemId: number; servings: number };
export type Totals = { proteinG: number; sodiumMg: number; potassiumMg: number; calories: number };

/** The generated plan for one meal of one day. */
export const plan = pgTable(
  "plan",
  {
    id: serial("id").primaryKey(),
    date: date("date").notNull(),
    meal: mealEnum("meal").notNull(),
    items: jsonb("items").$type<PlanItem[]>().notNull().default([]),
    totals: jsonb("totals").$type<Totals>(),
    reason: text("reason"),
    generator: text("generator"), // "greedy" | "llm"
    locked: boolean("locked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("plan_date_meal_uq").on(t.date, t.meal)],
);

/** What you actually ate. Nutrient values are snapshotted at log time. */
export const foodLog = pgTable("food_log", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  meal: mealEnum("meal").notNull(),
  menuItemId: integer("menu_item_id").references(() => menuItem.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  servings: real("servings").notNull().default(1),
  proteinG: real("protein_g").notNull().default(0),
  sodiumMg: integer("sodium_mg").notNull().default(0),
  potassiumMg: integer("potassium_mg").notNull().default(0),
  calories: integer("calories").notNull().default(0),
  kIsEstimate: boolean("k_is_estimate").notNull().default(true),
  source: logSourceEnum("source").notNull().default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Saved quick-add foods (a banana, a protein shake). Values are per 1 serving. */
export const favouriteFood = pgTable("favourite_food", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  proteinG: real("protein_g").notNull().default(0),
  sodiumMg: integer("sodium_mg").notNull().default(0),
  potassiumMg: integer("potassium_mg").notNull().default(0),
  calories: integer("calories").notNull().default(0),
  kIsEstimate: boolean("k_is_estimate").notNull().default(true),
});

/** Home mode: the fixed meal-prep template you edit by hand. */
export const mealTemplate = pgTable("meal_template", {
  id: serial("id").primaryKey(),
  meal: mealEnum("meal").notNull(),
  name: text("name").notNull(),
  servings: real("servings").notNull().default(1),
  proteinG: real("protein_g").notNull().default(0),
  sodiumMg: integer("sodium_mg").notNull().default(0),
  potassiumMg: integer("potassium_mg").notNull().default(0),
  calories: integer("calories").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
});

/** The tracker's daily row. */
export const habitDay = pgTable("habit_day", {
  date: date("date").primaryKey(),
  waterMl: integer("water_ml").notNull().default(0),
  neckSets: integer("neck_sets").notNull().default(0),
  gym: gymEnum("gym"),
  tretinoin: boolean("tretinoin").notNull().default(false),
  leetcode: integer("leetcode").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const applicationStatusEnum = pgEnum("application_status", [
  "wishlist",
  "applied",
  "oa",
  "interview",
  "offer",
  "rejected",
]);

export const application = pgTable("application", {
  id: serial("id").primaryKey(),
  company: text("company").notNull(),
  role: text("role").notNull(),
  status: applicationStatusEnum("status").notNull().default("applied"),
  appliedOn: date("applied_on"),
  link: text("link"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const milestone = pgTable("milestone", {
  id: serial("id").primaryKey(),
  project: text("project").notNull(), // "Roblox", "Side project", ...
  title: text("title").notNull(),
  dueDate: date("due_date"),
  done: boolean("done").notNull().default(false),
  doneAt: date("done_at"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
