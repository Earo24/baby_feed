import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildSolidFoodStartedAt,
  SolidFoodRecordRow,
} from '../src/components/solid-food';
import { SwipeToDelete } from '../src/components/swipe-to-delete';

const solidFoodSource = readFileSync(new URL('../src/components/solid-food.tsx', import.meta.url), 'utf8');

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

test('keeps the contextual delete action out of the closed-state tab order', () => {
  const markup = renderToStaticMarkup(createElement(
    SwipeToDelete,
    {
      deleteLabel: '删除辅食记录：米糊，12:30',
      onDelete: () => undefined,
    },
    createElement('div', null, '米糊'),
  ));

  assert.match(markup, /role="group" tabindex="0"/);
  assert.match(markup, /aria-label="删除辅食记录：米糊，12:30"[^>]*tabindex="-1"/);
  assert.match(markup, /class="[^"]*absolute right-0 top-0 bottom-0 flex w-20/);
  assert.match(markup, /aria-hidden="true" class="pointer-events-none/);
});

test('keeps the solid-food drawer keyboard-safe', () => {
  assert.match(solidFoodSource, /<Drawer\s+open[\s\S]*fixed\s*\n\s*repositionInputs/);
  assert.match(solidFoodSource, /FieldGroup className="[^\"]*min-h-0 flex-1[^\"]*overflow-y-auto[^\"]*pb-/);
  assert.match(solidFoodSource, /<DrawerFooter className="[^\"]*shrink-0/);
});
