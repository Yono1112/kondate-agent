/**
 * 消費期限文字列（YYYY-MM-DD）から今日との残日数を計算する。
 * 無効な日付文字列の場合は 0 を返す。
 */
export function calculateDaysRemaining(expiryDateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiryDate = new Date(expiryDateStr);
  if (isNaN(expiryDate.getTime())) return 0;
  expiryDate.setHours(0, 0, 0, 0);

  const diffMs = expiryDate.getTime() - today.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}
