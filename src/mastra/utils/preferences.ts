import { preferenceRowSchema } from './dbSchemas.js';

/**
 * preferences テーブルの行配列を { key: value } マップに変換する。
 * パース不能な行はスキップする。
 */
export function rowsToPreferenceMap(
  rows: Record<string, unknown>[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of rows) {
    const parsed = preferenceRowSchema.safeParse(row);
    if (parsed.success) {
      map[parsed.data.key] = parsed.data.value;
    }
  }
  return map;
}
