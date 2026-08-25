import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildSolidFoodStartedAt,
  SolidFoodRecordRow,
} from '../src/components/solid-food';

test('renders solid-food record details', () => {
  const now = new Date('2026-08-25T04:31:00.000Z');
  const expectedToday = new Date(now);
  expectedToday.setHours(12, 30, 0, 0);
  const expectedYesterday = new Date(now);
  expectedYesterday.setDate(expectedYesterday.getDate() - 1);
  expectedYesterday.setHours(12, 30, 0, 0);

  assert.equal(buildSolidFoodStartedAt('12:30', false, now), expectedToday.toISOString());
  assert.equal(buildSolidFoodStartedAt('12:30', true, now), expectedYesterday.toISOString());

  for (const invalidTime of ['', '12:3', '24:00', '25:99', '12:60']) {
    assert.equal(buildSolidFoodStartedAt(invalidTime, false, now), null, invalidTime);
  }

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
  assert.match(markup, /<time[^>]*dateTime="2026-08-25T04:30:00\.000Z"/);
});
