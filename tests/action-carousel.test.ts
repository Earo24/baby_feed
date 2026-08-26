import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTION_CAROUSEL_ITEMS,
  getActionCarouselLoopPosition,
  getActionCarouselSetWidth,
} from '../src/lib/action-carousel';

test('defines the four home action carousel items', () => {
  assert.deepEqual(ACTION_CAROUSEL_ITEMS, ['more', 'poop', 'feed', 'solid-food']);
});

test('calculates the width of one carousel item set', () => {
  assert.equal(getActionCarouselSetWidth(140), 560);
  assert.equal(getActionCarouselSetWidth(0), 0);
});

test('maps centered first and middle Feed positions into the middle carousel set', () => {
  const itemWidth = 140;
  const feedCenterWithinSet = 350;

  for (const viewportWidth of [390, 1280]) {
    const leadingInset = Math.max((viewportWidth - itemWidth) / 2, 0);
    const firstSetFeedScrollLeft = leadingInset + feedCenterWithinSet - viewportWidth / 2;
    const middleSetFeedScrollLeft = leadingInset + 560 + feedCenterWithinSet - viewportWidth / 2;

    assert.equal(firstSetFeedScrollLeft, 280);
    assert.equal(middleSetFeedScrollLeft, 840);
    assert.deepEqual(
      getActionCarouselLoopPosition(firstSetFeedScrollLeft, viewportWidth, itemWidth),
      { currentSet: 0, middleSetScrollLeft: middleSetFeedScrollLeft },
    );
    assert.deepEqual(
      getActionCarouselLoopPosition(middleSetFeedScrollLeft, viewportWidth, itemWidth),
      { currentSet: 1, middleSetScrollLeft: middleSetFeedScrollLeft },
    );
  }
});
