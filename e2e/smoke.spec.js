const { test, expect } = require('@playwright/test');

// The app loads without JavaScript errors and opens with its example lines.
// `npm run screenshot` also saves preview.png, used for link previews
// and on https://corey.sciu.to/projects/.
const APP = '/';
const PREVIEW = 'preview.png';
const READY = '#map path.land';

test('app loads without errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.goto(APP);
  await page.waitForLoadState('networkidle');
  await expect(page.locator(READY).first()).toBeVisible();
  await expect(page.locator('#list li')).toHaveCount(3);
  expect(errors).toEqual([]);
  if (process.env.UPDATE_PREVIEW) {
    await page.waitForTimeout(750);
    await page.screenshot({ path: PREVIEW });
  }
});

test('two clicks draw a line; Remove last takes it away', async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator(READY).first()).toBeVisible();
  const box = await page.locator('#map').boundingBox();
  await page.locator('#m-rh').click();
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.75);
  await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.55);
  await expect(page.locator('#list li')).toHaveCount(4);
  await expect(page.locator('#list li').last()).toHaveClass(/rh/);
  await expect(page.locator('#list li').last()).toContainText('Rhumb line');
  await page.locator('#undo').click();
  await expect(page.locator('#list li')).toHaveCount(3);
});

test('Compare both types adds the missing partner line', async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator('#list li')).toHaveCount(3);
  await page.locator('#pair').click();
  await expect(page.locator('#list li')).toHaveCount(4); // London–Sydney gains a rhumb line
});

test('phone: panel sits at the bottom and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(APP);
  await expect(page.locator(READY).first()).toBeVisible();
  const p = await page.locator('#panel').boundingBox();
  expect(p.y + p.height).toBeGreaterThan(844 - 40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('Unroll the globe loads without errors and shows the example routes', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/unroll/');
  await expect(page.locator('#bench canvas')).toBeVisible();
  await expect(page.locator('#measList li')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('routes travel to Unroll the globe and back', async ({ page }) => {
  await page.goto(APP);
  await page.locator('#pair').click();                    // 4 routes
  await expect(page.locator('#list li')).toHaveCount(4);
  await page.locator('#to-other').click();
  await expect(page).toHaveURL(/\/unroll\/#lines=/);
  await expect(page.locator('#measList li')).toHaveCount(4);
  await page.locator('#mUndo').click();                   // 3 routes
  await page.locator('#to-other').click();
  await expect(page.locator('#list li')).toHaveCount(3);
  await expect(page.locator('#list li').first()).toContainText('Boston → Moscow');  // city names come back
});

test('a shared link opens with its routes', async ({ page }) => {
  await page.goto(APP + '#lines=rh:-0.13,51.51,-74.01,40.71');
  await expect(page.locator('#list li')).toHaveCount(1);
  await expect(page.locator('#list li')).toContainText('London → New York');
});

test('search: a city, then typed coordinates, make a line', async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator('#list li')).toHaveCount(3);
  await page.locator('#q').fill('mumb');
  await expect(page.locator('#q-results li').first()).toContainText('Mumbai');
  await page.keyboard.press('Enter');
  await page.locator('#q').fill('35.68, 139.69');
  await expect(page.locator('#q-results li').first()).toContainText('35.68°N 139.69°E');
  await page.keyboard.press('Enter');
  await expect(page.locator('#list li')).toHaveCount(4);
  await expect(page.locator('#list li').last()).toContainText('Mumbai → 35.68°N 139.69°E');
});

test('a rhumb line with a great-circle partner shows how much longer it is', async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator('#list li.rh .extra')).toContainText('(11%) over the great circle');
});

test('the US-over-Europe demo hides routes instead of dragging them along', async ({ page }) => {
  await page.goto('/unroll/');
  await expect(page.locator('#measList li').first()).toContainText('Boston → Moscow');
  await page.locator('#demo').click();
  await expect(page.locator('#demo')).toBeEnabled({ timeout: 30000 });
  await expect(page.locator('#measList')).toContainText('Hidden while a country is moved');
  await page.locator('#pr-reset').click();
  await expect(page.locator('#measList li')).toHaveCount(2);
});
