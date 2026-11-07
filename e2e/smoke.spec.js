const { test, expect } = require('@playwright/test');

// The app loads without JavaScript errors and opens with its example routes.
// `npm run screenshot` also saves preview.png, used for link previews
// and on https://corey.sciu.to/projects/, and the help page's picture.
const APP = '/';
const PREVIEW = 'preview.png';
const READY = '#measList li';
const idle = (page) => page.waitForFunction(() => window.__lab && window.__lab.idle());

test('app loads without errors @desktop', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.goto(APP);
  await expect(page.locator('#bench canvas')).toBeVisible();
  await expect(page.locator(READY)).toHaveCount(2);
  expect(errors).toEqual([]);
  if (process.env.UPDATE_PREVIEW) {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: PREVIEW });
    await page.setViewportSize({ width: 1200, height: 740 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'help-unroll.png' });
  }
});

test('search: a city, then typed coordinates, make a route', async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator(READY)).toHaveCount(2);
  await page.locator('#q').fill('mumb');
  await expect(page.locator('#q-results li').first()).toContainText('Mumbai');
  await page.keyboard.press('Enter');
  await page.locator('#q').fill('35.68, 139.69');
  await expect(page.locator('#q-results li').first()).toContainText('35.68°N 139.69°E');
  await page.keyboard.press('Enter');
  await expect(page.locator(READY)).toHaveCount(3);
  await expect(page.locator(READY).last()).toContainText('Mumbai → Tokyo');
  await page.locator('#mUndo').click();
  await expect(page.locator(READY)).toHaveCount(2);
});

test('Compare both types adds the missing partner, and the rhumb line shows how much longer it is', async ({ page }) => {
  await page.goto(APP + '#lines=gc:-0.13,51.51,151.21,-33.87;rh:-71.06,42.36,37.62,55.76');
  await expect(page.locator(READY)).toHaveCount(2);
  await page.locator('#mPair').click();
  await expect(page.locator(READY)).toHaveCount(4);
  await expect(page.locator('#measList li.rh .extra').first()).toContainText('over the great circle');
});

test('a shared link opens with its routes, and old /unroll/ links still work', async ({ page }) => {
  await page.goto(APP + '#lines=rh:-0.13,51.51,-74.01,40.71');
  await expect(page.locator(READY)).toHaveCount(1);
  await expect(page.locator(READY)).toContainText('London → New York');
  await page.goto('/unroll/#lines=rh:-0.13,51.51,-74.01,40.71');
  await expect(page).toHaveURL(/\/#lines=rh:/);
  await expect(page.locator(READY)).toContainText('London → New York');
});

test('Unroll turns the stage into the wall map; clicking it adds a point @desktop', async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator('#flat')).toBeVisible();
  await page.locator('#st2').click();
  await idle(page);
  await expect(page.locator('#flat')).toBeHidden();       // no second copy of the map
  await expect(page.locator('#ro-pole')).toBeVisible();   // the readouts stay
  // click London and New York on the unrolled sheet
  for (const c of [[-0.13, 51.51], [-74.01, 40.71]]) {
    const xy = await page.evaluate(([lon, lat]) => {
      const S = window.__lab.S, M = window.__lab.M();
      const ll = lonlat(mv(M, vec(lon, lat)));
      const w = mv(S.C, flatPoint(rad(ll[0]), cylH(S.mode, rad(ll[1]))));
      return window.__lab.screenOf([w[1], w[2], w[0]]);
    }, c);
    await page.mouse.click(xy[0], xy[1]);
  }
  await expect(page.locator(READY)).toHaveCount(3);
  await expect(page.locator(READY).last()).toContainText('London → New York');
  await page.locator('#st0').click();
  await expect(page.locator('#flat')).toBeVisible();
});

test('the US-over-Europe demo hides routes instead of dragging them along', async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator(READY).first()).toContainText('Boston → Moscow');
  await page.locator('#demo').click();
  await expect(page.locator('#demo')).toBeEnabled({ timeout: 30000 });
  await expect(page.locator('#measList')).toContainText('Hidden while a country is moved');
  await page.locator('#pr-reset').click();
  await expect(page.locator(READY)).toHaveCount(2);
});

test('fits a phone: nothing scrolls sideways', async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator('#flat')).toBeVisible();
  const w = page.viewportSize().width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
});

test('Help, contact and a link back to the projects page', async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator('.foot .version')).toHaveText(/^(dev|v1\.\d+)$/);
  await page.locator('#help').click();
  await expect(page.locator('h1')).toContainText('How Mercator Lab works');
  for (const p of [APP, '/help.html']) {
    await page.goto(p);
    await expect(page.getByText(/corey\.sciuto\+\w+@gmail\.com/).first()).toBeAttached();
    await expect(page.locator('a[href="https://corey.sciu.to/projects/"]').first()).toBeAttached();
  }
});
