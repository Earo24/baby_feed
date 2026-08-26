import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTION_CAROUSEL_ITEMS,
  getActionCarouselSetWidth,
} from '../src/lib/action-carousel';

test('defines the four home action carousel items', () => {
  assert.deepEqual(ACTION_CAROUSEL_ITEMS, ['more', 'poop', 'feed', 'solid-food']);
});

test('calculates the width of one carousel item set', () => {
  assert.equal(getActionCarouselSetWidth(140), 560);
  assert.equal(getActionCarouselSetWidth(0), 0);
});
