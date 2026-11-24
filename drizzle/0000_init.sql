CREATE TYPE "public"."application_status" AS ENUM('wishlist', 'applied', 'oa', 'interview', 'offer', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."gym" AS ENUM('upper', 'lower');--> statement-breakpoint
CREATE TYPE "public"."item_kind" AS ENUM('protein', 'vegetable', 'starch', 'fruit', 'dairy', 'dessert', 'beverage', 'condiment', 'other');--> statement-breakpoint
CREATE TYPE "public"."k_source" AS ENUM('cnf', 'manual', 'llm');--> statement-breakpoint
CREATE TYPE "public"."log_source" AS ENUM('plan', 'swap', 'manual', 'template');--> statement-breakpoint
CREATE TYPE "public"."meal" AS ENUM('breakfast', 'lunch', 'dinner', 'snack');--> statement-breakpoint
CREATE TYPE "public"."mode" AS ENUM('home', 'dining');--> statement-breakpoint
CREATE TABLE "application" (
	"id" serial PRIMARY KEY NOT NULL,
	"company" text NOT NULL,
	"role" text NOT NULL,
	"status" "application_status" DEFAULT 'applied' NOT NULL,
	"applied_on" date,
	"link" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favourite_food" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"protein_g" real DEFAULT 0 NOT NULL,
	"sodium_mg" integer DEFAULT 0 NOT NULL,
	"potassium_mg" integer DEFAULT 0 NOT NULL,
	"calories" integer DEFAULT 0 NOT NULL,
	"k_is_estimate" boolean DEFAULT true NOT NULL,
	CONSTRAINT "favourite_food_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "food_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"meal" "meal" NOT NULL,
	"menu_item_id" integer,
	"name" text NOT NULL,
	"servings" real DEFAULT 1 NOT NULL,
	"protein_g" real DEFAULT 0 NOT NULL,
	"sodium_mg" integer DEFAULT 0 NOT NULL,
	"potassium_mg" integer DEFAULT 0 NOT NULL,
	"calories" integer DEFAULT 0 NOT NULL,
	"k_is_estimate" boolean DEFAULT true NOT NULL,
	"source" "log_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "habit_day" (
	"date" date PRIMARY KEY NOT NULL,
	"water_ml" integer DEFAULT 0 NOT NULL,
	"neck_sets" integer DEFAULT 0 NOT NULL,
	"gym" "gym",
	"tretinoin" boolean DEFAULT false NOT NULL,
	"leetcode" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "k_mapping" (
	"id" serial PRIMARY KEY NOT NULL,
	"ingredient_text" text NOT NULL,
	"food_code" integer,
	"food_name" text,
	"mg_per_100g" real,
	"confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "k_mapping_ingredient_text_unique" UNIQUE("ingredient_text")
);
--> statement-breakpoint
CREATE TABLE "meal_template" (
	"id" serial PRIMARY KEY NOT NULL,
	"meal" "meal" NOT NULL,
	"name" text NOT NULL,
	"servings" real DEFAULT 1 NOT NULL,
	"protein_g" real DEFAULT 0 NOT NULL,
	"sodium_mg" integer DEFAULT 0 NOT NULL,
	"potassium_mg" integer DEFAULT 0 NOT NULL,
	"calories" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_day" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"meal" "meal" NOT NULL,
	"station" text,
	"menu_item_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"station" text,
	"kind" "item_kind",
	"serving_size" text NOT NULL,
	"serving_amount" real,
	"serving_unit" text,
	"calories" integer,
	"fat_g" real,
	"sat_fat_g" real,
	"trans_fat_g" real,
	"cholesterol_mg" integer,
	"sodium_mg" integer,
	"carbs_g" real,
	"fiber_g" real,
	"sugars_g" real,
	"protein_g" real,
	"ingredients" text,
	"allergens" text[],
	"k_mg_est" integer,
	"k_source" "k_source",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestone" (
	"id" serial PRIMARY KEY NOT NULL,
	"project" text NOT NULL,
	"title" text NOT NULL,
	"due_date" date,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"meal" "meal" NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"totals" jsonb,
	"reason" text,
	"generator" text,
	"locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"mode" "mode" DEFAULT 'home' NOT NULL,
	"protein_target_g" integer DEFAULT 140 NOT NULL,
	"calorie_target" integer DEFAULT 1750 NOT NULL,
	"calorie_tolerance" integer DEFAULT 100 NOT NULL,
	"sodium_cap_mg" integer DEFAULT 2300 NOT NULL,
	"potassium_goal_mg" integer DEFAULT 3400 NOT NULL,
	"protein_split" jsonb DEFAULT '{"breakfast":30,"lunch":45,"dinner":45,"snack":20}'::jsonb NOT NULL,
	"blocked_foods" text[] DEFAULT '{"pork","tofu"}' NOT NULL,
	"preferred_stations" text[] DEFAULT '{}' NOT NULL,
	"water_goal_ml" integer DEFAULT 3000 NOT NULL,
	"neck_sets_goal" integer DEFAULT 3 NOT NULL,
	"gym_per_week" integer DEFAULT 4 NOT NULL,
	"leetcode_goal" integer DEFAULT 1 NOT NULL,
	"tretinoin_start" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "food_log" ADD CONSTRAINT "food_log_menu_item_id_menu_item_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_day" ADD CONSTRAINT "menu_day_menu_item_id_menu_item_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "menu_day_uq" ON "menu_day" USING btree ("date","meal","menu_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_item_source_serving_uq" ON "menu_item" USING btree ("source_id","serving_size");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_date_meal_uq" ON "plan" USING btree ("date","meal");