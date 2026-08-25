import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatSolidFoodAmount,
  normalizeSolidFoodInput,
  SOLID_FOOD_UNIT_OPTIONS,
  type SolidFoodUnit,
} from '../src/lib/solid-food';

// @ts-expect-error 'none' is a form sentinel, not a persisted amount unit.
const invalidSolidFoodUnit: SolidFoodUnit = 'none';
void invalidSolidFoodUnit;

test('exposes solid-food units in display order', () => {
  assert.deepEqual(SOLID_FOOD_UNIT_OPTIONS, [
    { value: 'g', label: '克' },
    { value: 'ml', label: '毫升' },
    { value: 'spoon', label: '勺' },
    { value: 'bowl', label: '碗' },
    { value: 'none', label: '无单位' },
  ]);
});

test('normalizes a complete solid-food input', () => {
  const result = normalizeSolidFoodInput({
    food_name: '  米糊  ',
    amount_value: '0.5',
    amount_unit: 'bowl',
    recorder_name: ' 妈妈 ',
    note: ' 第一次尝试 ',
    started_at: '2026-08-25T04:30:00.000Z',
  });

  assert.deepEqual(result, {
    success: true,
    data: {
      food_name: '米糊',
      amount_value: 0.5,
      amount_unit: 'bowl',
      recorder_name: '妈妈',
      note: '第一次尝试',
      started_at: '2026-08-25T04:30:00.000Z',
    },
  });
});

test('allows a name-only record and drops a unit without an amount', () => {
  const result = normalizeSolidFoodInput({ food_name: '香蕉', amount_unit: 'g' });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.amount_value, null);
    assert.equal(result.data.amount_unit, null);
  }
});

test('normalizes form sentinels and blank optional text', () => {
  const result = normalizeSolidFoodInput({
    food_name: '苹果泥',
    amount_value: 2,
    amount_unit: 'none',
    recorder_name: '   ',
    note: '',
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.amount_value, 2);
    assert.equal(result.data.amount_unit, null);
    assert.equal(result.data.recorder_name, null);
    assert.equal(result.data.note, null);
  }
});

test('defaults missing, null, and blank times within the call window', () => {
  const cases: Array<{ label: string; input: Record<string, unknown> }> = [
    { label: 'missing', input: {} },
    { label: 'null', input: { started_at: null } },
    { label: 'blank', input: { started_at: '   ' } },
  ];

  for (const { label, input } of cases) {
    const before = Date.now();
    const result = normalizeSolidFoodInput({ food_name: '南瓜泥', ...input });
    const after = Date.now();

    assert.equal(result.success, true, label);
    if (result.success) {
      assert.match(result.data.started_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      const timestamp = Date.parse(result.data.started_at);
      assert.ok(timestamp >= before, `${label}: timestamp is before the call`);
      assert.ok(timestamp <= after, `${label}: timestamp is after the call`);
    }
  }
});

test('canonicalizes a valid ISO timestamp with an offset', () => {
  const result = normalizeSolidFoodInput({
    food_name: '胡萝卜泥',
    started_at: '2026-08-25T12:30:00+08:00',
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.started_at, '2026-08-25T04:30:00.000Z');
  }
});

test('rejects blank names and invalid units', () => {
  assert.deepEqual(normalizeSolidFoodInput({ food_name: ' ' }), { success: false, error: '请输入食物名称' });
  assert.deepEqual(normalizeSolidFoodInput({ food_name: '米糊', amount_value: 2, amount_unit: 'cup' }), { success: false, error: '无效的食用量单位' });
});

test('rejects non-positive, non-finite, and nonnumeric amounts', () => {
  const invalidAmounts: unknown[] = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 'not-a-number'];

  for (const amount_value of invalidAmounts) {
    assert.deepEqual(
      normalizeSolidFoodInput({ food_name: '米糊', amount_value }),
      { success: false, error: '食用量必须大于 0' },
    );
  }
});

test('rejects non-string, impossible, and malformed timestamps', () => {
  const invalidTimes: unknown[] = [
    0,
    '2026-02-30T00:00:00.000Z',
    'not-a-date',
    '2026-08-25T04:30:00',
  ];

  for (const started_at of invalidTimes) {
    assert.deepEqual(
      normalizeSolidFoodInput({ food_name: '米糊', started_at }),
      { success: false, error: '无效的记录时间' },
    );
  }
});

test('formats known and unitless amounts', () => {
  assert.equal(formatSolidFoodAmount(30, 'g'), '30克');
  assert.equal(formatSolidFoodAmount(20, 'ml'), '20毫升');
  assert.equal(formatSolidFoodAmount(1, 'spoon'), '1勺');
  assert.equal(formatSolidFoodAmount(0.5, 'bowl'), '0.5碗');
  assert.equal(formatSolidFoodAmount(2, null), '2');
  assert.equal(formatSolidFoodAmount(null, 'ml'), '');
});
