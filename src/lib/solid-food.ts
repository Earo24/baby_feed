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

const UNIT_LABELS: Record<SolidFoodUnit, string> = {
  g: '克',
  ml: '毫升',
  spoon: '勺',
  bowl: '碗',
};

const VALID_UNITS = new Set<SolidFoodUnit>(['g', 'ml', 'spoon', 'bowl']);

function optionalTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
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

  const rawStartedAt = source.started_at;
  const startedAt = rawStartedAt === undefined || rawStartedAt === null || rawStartedAt === ''
    ? new Date().toISOString()
    : String(rawStartedAt);
  if (Number.isNaN(Date.parse(startedAt))) {
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
      started_at: new Date(startedAt).toISOString(),
    },
  };
}

export function formatSolidFoodAmount(value: number | null, unit: SolidFoodUnit | null): string {
  if (value === null) return '';
  return `${value}${unit ? UNIT_LABELS[unit] : ''}`;
}
