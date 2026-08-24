export function getChinaCycleStart(days = 1): string {
  const safeDays = Math.min(Math.max(Number.isFinite(days) ? Math.trunc(days) : 1, 1), 30);
  const chinaOffsetMs = 8 * 60 * 60 * 1000;
  const chinaTime = new Date(Date.now() + chinaOffsetMs);
  const chinaHours = chinaTime.getUTCHours();
  const startDateChina = new Date(chinaTime);

  if (chinaHours < 6) {
    startDateChina.setUTCDate(startDateChina.getUTCDate() - 1);
  }
  startDateChina.setUTCDate(startDateChina.getUTCDate() - (safeDays - 1));
  startDateChina.setUTCHours(8, 0, 0, 0);

  return new Date(startDateChina.getTime() - chinaOffsetMs).toISOString();
}
