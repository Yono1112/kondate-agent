import { z } from 'zod';

// InventoryRow

export const inventoryRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  quantity: z.coerce.number(),
  unit: z.string(),
  expiry_date: z.string().nullish().transform((v) => v ?? null),
  purchased_at: z.string().nullish().transform((v) => v ?? null),
});

export type InventoryRow = z.infer<typeof inventoryRowSchema>;

export function parseInventoryRow(row: Record<string, unknown>): InventoryRow {
  return inventoryRowSchema.parse(row);
}

// MealRow

export const mealRowSchema = z.object({
  id: z.string(),
  date: z.string(),
  meal_type: z.string(),
  dish_name: z.string(),
  ingredients: z.string(),
  notes: z.string().nullish().transform((v) => v ?? null),
});

export type MealRow = z.infer<typeof mealRowSchema>;

export function parseMealRow(row: Record<string, unknown>): MealRow {
  return mealRowSchema.parse(row);
}

// PreferenceRow

export const preferenceRowSchema = z.object({
  key: z.string(),
  value: z.string(),
});

export type PreferenceRow = z.infer<typeof preferenceRowSchema>;

// RecipeRow

export const recipeRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  channel_name: z.string(),
  channel_id: z.string(),
  video_id: z.string(),
  video_url: z.string(),
  description: z.string(),
  ingredients: z.string(),
  cook_time_minutes: z.coerce.number().nullish().transform((v) => v ?? null),
  category: z.string().nullish().transform((v) => v ?? null),
  summary: z.string().nullish().transform((v) => v ?? null),
});

export type RecipeRow = z.infer<typeof recipeRowSchema>;

export function parseRecipeRow(row: Record<string, unknown>): RecipeRow {
  return recipeRowSchema.parse(row);
}
