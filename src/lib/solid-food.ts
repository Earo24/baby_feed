export const SOLID_FOOD_UNIT_OPTIONS = [
  { value: 'g', label: '克' },
  { value: 'ml', label: '毫升' },
  { value: 'spoon', label: '勺' },
  { value: 'bowl', label: '碗' },
  { value: 'none', label: '无单位' },
] as const;

export type SolidFoodUnit = Exclude<(typeof SOLID_FOOD_UNIT_OPTIONS)[number]['value'], 'none'>;

export interface SolidFoodRecord {
  id: string;
  recorder_name: string | null;
  food_name: string;
  amount_value: number | null;
  amount_unit: SolidFoodUnit | null;
  note: string | null;
  started_at: string;
  created_at: string;
}

export interface NormalizedSolidFoodInput {
  recorder_name: string | null;
  food_name: string;
  amount_value: number | null;
  amount_unit: SolidFoodUnit | null;
  note: string | null;
  started_at: string;
}

export type SolidFoodInputResult =
  | { success: true; data: NormalizedSolidFoodInput }
  | { success: false; error: string };

type SolidFoodUnitOption = Extract<
  (typeof SOLID_FOOD_UNIT_OPTIONS)[number],
  { value: SolidFoodUnit }
>;

const SOLID_FOOD_UNIT_ENTRIES = SOLID_FOOD_UNIT_OPTIONS.filter(
  (option): option is SolidFoodUnitOption => option.value !== 'none',
);
const UNIT_LABELS = Object.fromEntries(
  SOLID_FOOD_UNIT_ENTRIES.map(({ value, label }) => [value, label]),
) as Record<SolidFoodUnit, string>;
const VALID_UNITS = new Set<SolidFoodUnit>(
  SOLID_FOOD_UNIT_ENTRIES.map(({ value }) => value),
);

const ISO_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-](\d{2}):(\d{2}))$/;
const DAYS_BY_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function optionalTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function normalizeStartedAt(value: unknown): string | null {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return new Date().toISOString();
  }
  if (typeof value !== 'string') return null;

  const match = ISO_DATETIME_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  const seconds = Number(match[6]);
  const offsetHours = match[9] === undefined ? 0 : Number(match[9]);
  const offsetMinutes = match[10] === undefined ? 0 : Number(match[10]);

  if (month < 1 || month > 12 || hours > 23 || minutes > 59 || seconds > 59) return null;
  if (offsetHours > 23 || offsetMinutes > 59) return null;

  const daysInMonth = month === 2 && isLeapYear(year) ? 29 : DAYS_BY_MONTH[month - 1];
  if (day < 1 || day > daysInMonth) return null;

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

export function normalizeSolidFoodInput(input: unknown): SolidFoodInputResult {
  const source = typeof input === 'object' && input !== null
    ? input as Record<string, unknown>
    : {};
  const foodName = optionalTrimmedString(source.food_name);
  if (!foodName) return { success: false, error: '请输入食物名称' };

  const rawAmount = source.amount_value;
  const hasAmount = rawAmount !== undefined
    && rawAmount !== null
    && !(typeof rawAmount === 'string' && rawAmount.trim() === '');
  let amountValue: number | null = null;
  if (hasAmount) {
    amountValue = typeof rawAmount === 'number'
      ? rawAmount
      : typeof rawAmount === 'string'
        ? Number(rawAmount)
        : Number.NaN;
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      return { success: false, error: '食用量必须大于 0' };
    }
  }

  let amountUnit: SolidFoodUnit | null = null;
  if (amountValue !== null) {
    const rawUnit = typeof source.amount_unit === 'string'
      ? source.amount_unit.trim()
      : source.amount_unit;
    if (rawUnit !== undefined && rawUnit !== null && rawUnit !== '' && rawUnit !== 'none') {
      if (typeof rawUnit !== 'string' || !VALID_UNITS.has(rawUnit as SolidFoodUnit)) {
        return { success: false, error: '无效的食用量单位' };
      }
      amountUnit = rawUnit as SolidFoodUnit;
    }
  }

  const startedAt = normalizeStartedAt(source.started_at);
  if (startedAt === null) {
    return { success: false, error: '无效的记录时间' };
  }

  return {
    success: true,
    data: {
      recorder_name: optionalTrimmedString(source.recorder_name),
      food_name: foodName,
      amount_value: amountValue,
      amount_unit: amountUnit,
      note: optionalTrimmedString(source.note),
      started_at: startedAt,
    },
  };
}

export function formatSolidFoodAmount(value: number | null, unit: SolidFoodUnit | null): string {
  if (value === null) return '';
  return `${value}${unit ? UNIT_LABELS[unit] : ''}`;
}
