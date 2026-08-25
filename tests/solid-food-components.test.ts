import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SolidFoodRecordRow } from '../src/components/solid-food';

test('renders solid-food record details', () => {
  const markup = renderToStaticMarkup(createElement(SolidFoodRecordRow, {
    record: {
      id: 'solid-1',
      recorder_name: '妈妈',
      food_name: '米糊',
      amount_value: 0.5,
      amount_unit: 'bowl',
      note: '第一次尝试',
      started_at: '2026-08-25T04:30:00.000Z',
      created_at: '2026-08-25T04:31:00.000Z',
    },
  }));

  assert.match(markup, /米糊/);
  assert.match(markup, /0\.5碗/);
  assert.match(markup, /第一次尝试/);
  assert.match(markup, /妈妈/);
});
