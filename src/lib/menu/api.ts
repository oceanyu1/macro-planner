/**
 * MyDiningHub's menu API (Adobe Commerce "API Mesh", public GraphQL over GET).
 * Captured from the Teraanga Commons page on 2026-11-24; see AGENTS.md "Menu API".
 * No login or secret: the key and customer group below are the public values
 * the website itself sends.
 */
import type { MealName } from "@/db/schema";

export const ENDPOINT =
  "https://api.elevate-dxp.com/api/mesh/c087f756-cc72-4649-a36f-3a41b700c519/graphql";

export const HEADERS: Record<string, string> = {
  accept: "application/graphql-response+json,application/json;q=0.9",
  "content-type": "application/json",
  "aem-elevate-clientpath": "can/carleton/en",
  "magento-customer-group": "b6589fc6ab0dc82cf12099d1c2d40ab994e8410c", // guest
  "magento-store-code": "can_carleton",
  "magento-store-view-code": "can_carleton_en",
  "magento-website-code": "can_carleton",
  store: "can_carleton_en",
  "x-api-key": "ElevateAPIProd",
  // Identify ourselves plainly: one person's meal planner, a few requests a night.
  "user-agent": "macro-planner/1.0 (personal meal planner; ~21 requests per day)",
};

export const CAMPUS = "campus";
export const LOCATION = "teraanga-commons-dining-hall";

/** MyDiningHub meal period ids (from getLocation.meal_periods). */
export const MEAL_PERIOD = {
  breakfast: 10,
  brunch: 13,
  lunch: 25,
  dinner: 16,
  allDay: 4,
} as const;

/** The meals we ingest, in order, with the period to try if the first is empty (weekend brunch). */
export const INGEST_MEALS: { meal: Exclude<MealName, "snack">; periods: number[] }[] = [
  { meal: "breakfast", periods: [MEAL_PERIOD.breakfast] },
  { meal: "lunch", periods: [MEAL_PERIOD.lunch, MEAL_PERIOD.brunch] },
  { meal: "dinner", periods: [MEAL_PERIOD.dinner] },
];

/** Station id → name, from getLocation (fixtures/stations.json). Unknown ids fall back to "Station <id>". */
export const STATIONS: Record<number, string> = {
  295922: "Grill 42",
  295955: "Grill 42 Comfort",
  295940: "Training Table",
  295937: "Umami",
  295931: "True Balance",
  277733: "Vegan",
  295952: "Sautee",
  277718: "Deli",
  277736: "Breakfast Only",
  277742: "Breakfast Bar",
  277730: "Main",
  277727: "Pasta",
  277721: "Sides",
  277745: "Salad",
  277724: "Soup",
  277739: "Bakery",
  295925: "Smoothie Station",
  295928: "All Day Breakfast",
  295934: "MTO Toast",
  295946: "Pizza",
  295949: "Omelettes",
};

/** Sent verbatim, exactly as the site sends it, so the mesh can serve it from cache. */
export const LOCATION_RECIPES_QUERY =
  "query getLocationRecipes($campusUrlKey:String!$locationUrlKey:String!$date:String!$mealPeriod:Int$viewType:Commerce_MenuViewType!){getLocationRecipes(campusUrlKey:$campusUrlKey locationUrlKey:$locationUrlKey date:$date mealPeriod:$mealPeriod viewType:$viewType){locationRecipesMap{skus stationSkuMap{id skus __typename}dateSkuMap{date stations{id skus{simple configurable{sku variants __typename}__typename}__typename}__typename}__typename}products{items{id name sku images{label roles url __typename}attributes{name value __typename}...on Catalog_SimpleProductView{price{final{amount{currency value __typename}__typename}__typename}__typename}...on Catalog_ComplexProductView{options{title values{id title ...on Catalog_ProductViewOptionValueProduct{product{name sku attributes{name value __typename}price{final{amount{value currency __typename}__typename}__typename}__typename}__typename}__typename}__typename}__typename}__typename}__typename}__typename}}";

export function locationRecipesUrl(date: string, mealPeriod: number): string {
  const params = new URLSearchParams({
    query: LOCATION_RECIPES_QUERY,
    operationName: "getLocationRecipes",
    variables: JSON.stringify({
      campusUrlKey: CAMPUS,
      locationUrlKey: LOCATION,
      date,
      mealPeriod,
      viewType: "DAILY",
    }),
  });
  return `${ENDPOINT}?${params}`;
}
