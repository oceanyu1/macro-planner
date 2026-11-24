-- Supabase exposes the public schema over its REST API with the public anon key.
-- RLS with no policies blocks that path; this app connects as the table owner, which bypasses RLS.
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "menu_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "menu_day" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "k_mapping" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "food_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "favourite_food" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meal_template" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "habit_day" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "application" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "milestone" ENABLE ROW LEVEL SECURITY;
