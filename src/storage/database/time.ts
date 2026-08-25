const CHINA_UTC_OFFSET_HOURS = 8;
const CHINA_CYCLE_START_HOUR = 8;

export function getChinaCycleStart(days = 1, now = new Date()): string {
  const safeDays = Math.min(Math.max(Number.isFinite(days) ? Math.trunc(days) : 1, 1), 30);
  const chinaOffsetMs = CHINA_UTC_OFFSET_HOURS * 60 * 60 * 1000;
  const chinaTime = new Date(now.getTime() + chinaOffsetMs);
  const chinaHours = chinaTime.getUTCHours();
  const startDateChina = new Date(chinaTime);

  if (chinaHours < CHINA_CYCLE_START_HOUR) {
    startDateChina.setUTCDate(startDateChina.getUTCDate() - 1);
  }
  startDateChina.setUTCDate(startDateChina.getUTCDate() - (safeDays - 1));
  startDateChina.setUTCHours(CHINA_CYCLE_START_HOUR, 0, 0, 0);

  return new Date(startDateChina.getTime() - chinaOffsetMs).toISOString();
}
