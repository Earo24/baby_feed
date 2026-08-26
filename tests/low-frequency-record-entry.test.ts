import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync(
  new URL('../src/app/page.tsx', import.meta.url),
  'utf8',
);

test('renders the approved four actions in order and removes direct low-frequency actions', () => {
  const start = pageSource.indexOf('{/* Action Buttons');
  const end = pageSource.indexOf('{showSolidFoodForm', start);
  const carousel = pageSource.slice(start, end);

  const more = carousel.indexOf('data-btn-type="more"');
  const poop = carousel.indexOf('data-btn-type="poop"');
  const feed = carousel.indexOf('data-btn-type="feed"');
  const solidFood = carousel.indexOf('data-btn-type="solid-food"');

  assert.ok(start >= 0 && end > start);
  assert.ok(more >= 0);
  assert.ok(more < poop && poop < feed && feed < solidFood);
  assert.doesNotMatch(carousel, /data-btn-type="awake"/);
  assert.doesNotMatch(carousel, /data-btn-type="med"/);
});

test('previews awake and medication inside the More button', () => {
  assert.match(pageSource, /aria-label="更多记录"/);
  assert.match(pageSource, /data-more-preview="awake"/);
  assert.match(pageSource, /data-more-preview="medication"/);
  assert.match(pageSource, />更多<\/span>/);
});

test('uses one accessible bottom sheet for both low-frequency actions', () => {
  assert.match(pageSource, /const \[showMoreRecords, setShowMoreRecords\] = useState\(false\)/);
  assert.match(pageSource, /id="more-records-title"/);
  assert.match(pageSource, /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby="more-records-title"/);
  assert.match(pageSource, /记录失败，请重试/);
  assert.match(pageSource, /setShowMoreRecords\(false\);[\s\S]*handleQuickAddMed\(\)/);
  assert.doesNotMatch(pageSource, /autoFocus/);
});

test('promotes an active awake record to a direct home action', () => {
  assert.match(pageSource, /aria-label=\{`已清醒\$\{awakeDuration\}，记为睡了`\}/);
  assert.match(pageSource, /onClick=\{handleEndAwake\}/);
  assert.match(pageSource, /已清醒 \{awakeDuration\}/);
  assert.match(pageSource, />睡了<\/span>/);
});

test('coordinates awake sync retries without repeating a create request', () => {
  const start = pageSource.indexOf('const handleQuickAddAwake');
  const end = pageSource.indexOf('const handleEndAwake', start);
  const handler = pageSource.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(pageSource, /const \[pendingAwakeStart, setPendingAwakeStart\] = useState<AwakeRecord \| null>\(null\)/);
  assert.match(pageSource, /coordinateAwakeStart\(\{/);
  assert.match(handler, /记录已保存，同步失败，请重试/);
  assert.match(pageSource, /pendingAwakeStart \? '重试同步' : room\.activeAwake \? '清醒中' : '清醒'/);
  assert.match(handler, /finally \{\s*setSubmitting\(false\);\s*\}/);
});

test('keeps the More overlay outside an inert background and closes it with Escape', () => {
  assert.match(pageSource, /<>\s*<div[^>]*inert=\{showMoreRecords\}/);
  assert.match(pageSource, /<\/div>\s*\{showMoreRecords \? \(/);
  assert.match(pageSource, /window\.addEventListener\('keydown', handleEscape\)/);
  assert.match(pageSource, /window\.removeEventListener\('keydown', handleEscape\)/);
  assert.doesNotMatch(pageSource, /autoFocus/);
});

test('scales only marked carousel labels and keeps the More divider aligned', () => {
  const scalingStart = pageSource.indexOf('const updateBtnScales');
  const scalingEnd = pageSource.indexOf('const checkBtnLoop', scalingStart);
  const scalingSource = pageSource.slice(scalingStart, scalingEnd);

  assert.match(scalingSource, /querySelectorAll(?:<HTMLElement>)?\('\[data-btn-label\]'\)/);
  assert.doesNotMatch(scalingSource, /querySelectorAll\('span'\)/);
  assert.match(scalingSource, /data-more-divider/);
  assert.match(pageSource, /data-btn-label/);
});
