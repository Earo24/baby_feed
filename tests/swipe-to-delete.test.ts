import assert from 'node:assert/strict';
import test from 'node:test';

import {
  beginSwipeDelete,
  cancelSwipeDelete,
  commitSwipeDelete,
  createSwipeDeleteState,
  moveSwipeDelete,
} from '../src/lib/swipe-to-delete';

test('commits only after crossing the delete threshold', () => {
  const started = beginSwipeDelete(createSwipeDeleteState(), 1, 100);
  const belowThreshold = moveSwipeDelete(started, 1, 61);
  assert.equal(commitSwipeDelete(belowThreshold, 1).offset, 0);

  const aboveThreshold = moveSwipeDelete(started, 1, 59);
  assert.equal(commitSwipeDelete(aboveThreshold, 1).offset, -80);
});

test('normal left swipe clamps and opens the delete action', () => {
  const started = beginSwipeDelete(createSwipeDeleteState(), 7, 200);
  const moved = moveSwipeDelete(started, 7, 80);
  assert.equal(moved.offset, -80);
  assert.deepEqual(commitSwipeDelete(moved, 7), createSwipeDeleteState(-80));
});

test('cancel restores the offset from before the gesture', () => {
  const opened = createSwipeDeleteState(-80);
  const started = beginSwipeDelete(opened, 3, 100);
  const moved = moveSwipeDelete(started, 3, 160);
  assert.equal(moved.offset, -20);
  assert.deepEqual(cancelSwipeDelete(moved, 3), opened);
});

test('ignores a second pointer for move, commit, and cancel', () => {
  const started = beginSwipeDelete(createSwipeDeleteState(), 11, 100);
  assert.equal(beginSwipeDelete(started, 12, 90), started);
  assert.equal(moveSwipeDelete(started, 12, 0), started);
  assert.equal(commitSwipeDelete(started, 12), started);
  assert.equal(cancelSwipeDelete(started, 12), started);
});
