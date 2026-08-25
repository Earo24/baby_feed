import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSolidFoodAmount, normalizeSolidFoodInput } from '../src/lib/solid-food';

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

test('rejects blank names, non-positive amounts, invalid units, and invalid dates', () => {
  assert.deepEqual(normalizeSolidFoodInput({ food_name: ' ' }), { success: false, error: '请输入食物名称' });
  assert.deepEqual(normalizeSolidFoodInput({ food_name: '米糊', amount_value: 0 }), { success: false, error: '食用量必须大于 0' });
  assert.deepEqual(normalizeSolidFoodInput({ food_name: '米糊', amount_value: 2, amount_unit: 'cup' }), { success: false, error: '无效的食用量单位' });
  assert.deepEqual(normalizeSolidFoodInput({ food_name: '米糊', started_at: 'not-a-date' }), { success: false, error: '无效的记录时间' });
});

test('formats known and unitless amounts', () => {
  assert.equal(formatSolidFoodAmount(30, 'g'), '30克');
  assert.equal(formatSolidFoodAmount(0.5, 'bowl'), '0.5碗');
  assert.equal(formatSolidFoodAmount(2, null), '2');
  assert.equal(formatSolidFoodAmount(null, 'ml'), '');
});
