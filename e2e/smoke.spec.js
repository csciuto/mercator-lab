const { test, expect } = require('@playwright/test');

// The spec's checklist, as far as a machine can check it. `npm run screenshot` also saves preview.png
// (link previews and https://corey.sciu.to/projects/) and the help page's picture.
const APP = '/';
const PREVIEW = 'preview.png';
const READY = '#routes li';
const ROUTE = '#routes li:not(.empty)';
const BOS_ROM = '#routes=-71.06,42.36,12.5,41.9';
const idle = (page) => page.waitForFunction(() => window.__lab && window.__lab.idle());
const counts = (page) => page.evaluate(() => window.__lab.counts());
// screen position of an Earth point at the current step
const screenOf = (page, c) => page.evaluate(([lon, lat]) => {
  const S = window.__lab.S, M = window.__lab.M();
  if (S.s > 1.5) {
    const ll = lonlat(mv(M, vec(lon, lat)));
    const w = mv(S.C, flatPoint(rad(ll[0]), cylH(rad(ll[1]))));
    return window.__lab.screenOf([w[1], w[2], w[0]]);
  }
  const g = mv(S.G, vec(lon, lat));
  return window.__lab.screenOf([g[1], g[2], g[0]]);
}, c);

test('opens on a plain globe: no cylinder, nothing projected @desktop', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.goto(APP + (process.env.UPDATE_PREVIEW ? BOS_ROM + ';-0.13,51.51,139.69,35.69' : ''));
  await expect(page.locator('#live canvas')).toBeVisible();
  await expect(page.locator(READY).first()).toBeVisible();
  const c = await counts(page);
  expect(c.wire + c.coast).toBe(0);
  expect(await page.evaluate(() => window.__lab.S.cylOn)).toBe(false);
  expect(errors).toEqual([]);
  if (process.env.UPDATE_PREVIEW) {
    await page.locator('#st2').click(); await idle(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: PREVIEW });
    await page.setViewportSize({ width: 1200, height: 740 });
    await page.locator('#st3').click(); await idle(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'help-unroll.png' });
  }
});

test('the panel fits a 1280 × 800 screen without scrolling @desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(APP + BOS_ROM + ';-0.13,51.51,139.69,35.69');
  await expect(page.locator(ROUTE)).toHaveCount(2);
  const [sh, ch] = await page.locator('#side').evaluate((el) => [el.scrollHeight, el.clientHeight]);
  expect(sh).toBeLessThanOrEqual(ch);
});

test('From shows its name right away; To makes a route with both lines and both distances', async ({ page }) => {
  await page.goto(APP);
  await page.locator('#from').fill('bost');
  await expect(page.locator('#from-results li').first()).toContainText('Boston');
  await page.keyboard.press('Enter');
  await expect(page.locator('#from')).toHaveValue('Boston');
  expect(await page.evaluate(() => window.__lab.S.from.name)).toBe('Boston');
  await page.locator('#to').fill('rome');
  await page.locator('#to-results li', { hasText: 'IT' }).first().click();
  await expect(page.locator(ROUTE)).toHaveCount(1);
  await expect(page.locator(ROUTE)).toContainText('Boston → Rome');
  await expect(page.locator(ROUTE)).toContainText(/Great circle 6,5\d\d km/);
  await expect(page.locator(ROUTE)).toContainText(/Rhumb 6,8\d\d km/);
  await expect(page.locator(ROUTE)).toContainText('+4.6%');
  const c = await counts(page);
  expect(c.routes).toBeGreaterThanOrEqual(2);   // a great circle and a rhumb line
  await expect(page.locator('#from')).toHaveValue('');
  await expect(page).toHaveURL(/#routes=/);
});

test('typed coordinates work, and London → Tokyo shows a bigger rhumb penalty', async ({ page }) => {
  await page.goto(APP);
  await page.locator('#from').fill('51.51, -0.13');
  await page.keyboard.press('Enter');
  await page.locator('#to').fill('35.69N 139.69E');
  await page.keyboard.press('Enter');
  await expect(page.locator(ROUTE)).toContainText(/\+1[5-9]%/);
});

test('clicking the globe fills From, then To @desktop', async ({ page }) => {
  await page.goto(APP);
  await idle(page);
  for (const c of [[-0.13, 51.51], [2.35, 48.86]]) {
    const xy = await screenOf(page, c);
    await page.mouse.click(xy[0], xy[1]);
  }
  await expect(page.locator(ROUTE)).toHaveCount(1);
  await expect(page.locator(ROUTE)).toContainText('→');
});

test('a shared link reopens its routes; old /lines= and /unroll/ links still work', async ({ page }) => {
  await page.goto(APP + '#routes=-0.13,51.51,-74.01,40.71');
  await expect(page.locator(ROUTE)).toContainText('London → New York');
  await page.goto(APP + '#lines=gc:-0.13,51.51,-74.01,40.71;rh:-0.13,51.51,-74.01,40.71');
  await expect(page.locator(ROUTE)).toHaveCount(1);
  await page.goto('/unroll/#lines=rh:-0.13,51.51,-74.01,40.71');
  await expect(page.locator(ROUTE)).toContainText('London → New York');
});

test('× removes one route; Clear routes removes them all', async ({ page }) => {
  await page.goto(APP + BOS_ROM + ';-0.13,51.51,139.69,35.69');
  await expect(page.locator(ROUTE)).toHaveCount(2);
  await page.locator('#routes .x').first().click();
  await expect(page.locator(ROUTE)).toHaveCount(1);
  await page.locator('#clearRoutes').click();
  await expect(page.locator(ROUTE)).toHaveCount(0);
  await expect(page.locator(READY)).toHaveText('No routes yet');
});

test('Project brings the cylinder with the map on it; Globe takes both away', async ({ page }) => {
  await page.goto(APP + BOS_ROM);
  await expect(page.locator('#st1')).toHaveCount(0);   // no empty-cylinder step
  await page.locator('#st2').click(); await idle(page);
  let c = await counts(page);
  expect(c.wire).toBeGreaterThan(0);
  expect(c.coast).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__lab.map())).toEqual({ visible: true, opacity: 0.85 });   // filled map
  await page.locator('#mapOpacity').fill('30'); await idle(page);
  expect((await page.evaluate(() => window.__lab.map())).opacity).toBeCloseTo(0.3);
  await page.locator('#pr-trans').click(); await idle(page);
  await expect(page.locator('#touch')).toHaveText('Transverse · touches the 0° meridian');
  await page.locator('#st0').click(); await idle(page);
  expect((await page.evaluate(() => window.__lab.map())).visible).toBe(false);   // no fill without the cylinder
  c = await counts(page);
  expect(c.wire + c.coast).toBe(0);
  await page.locator('#pr-obl').click(); await idle(page);   // turning the cylinder at Globe projects
  await expect(page.locator('#st2')).toHaveAttribute('aria-pressed', 'true');
});

test('Unroll: the map faces you and a click adds a point; Reset stays on Unroll and keeps routes @desktop', async ({ page }) => {
  await page.goto(APP + BOS_ROM);
  await page.locator('#st3').click(); await idle(page);
  for (const c of [[151.21, -33.87], [-70.67, -33.45]]) {
    const xy = await screenOf(page, c);
    await page.mouse.click(xy[0], xy[1]);
  }
  await expect(page.locator(ROUTE)).toHaveCount(2);
  await expect(page.locator(ROUTE).last()).toContainText('Sydney');
  await page.locator('#g0').fill('40');
  await page.locator('#reset').click(); await idle(page);
  const S = await page.evaluate(() => ({ step: window.__lab.S.step, s: window.__lab.S.s, G: window.__lab.S.G }));
  expect(S.step).toBe(3);
  expect(S.s).toBe(2);
  expect(Math.abs(S.G[0][0] - 1)).toBeLessThan(1e-6);
  await expect(page.locator('#st3')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(ROUTE)).toHaveCount(2);
});

test('Freeze keeps a still copy of the wall map; only the live view changes', async ({ page }) => {
  await page.goto(APP + BOS_ROM);
  await page.locator('#freeze').click(); await idle(page);
  await expect(page.locator('#frozen')).toBeVisible();
  await expect(page.locator('#frozenLabel')).toHaveText('Frozen · Normal · touches the equator');
  const before = await page.evaluate(() => JSON.stringify(window.__lab.frozen()));
  await page.locator('#pr-trans').click(); await idle(page);
  await page.locator('#g0').fill('60'); await idle(page);
  await expect(page.locator('#touch')).toContainText('Transverse');
  expect(await page.evaluate(() => JSON.stringify(window.__lab.frozen()))).toBe(before);
  await expect(page.locator('#frozenLabel')).toHaveText('Frozen · Normal · touches the equator');
  await page.locator('#freeze').click(); await idle(page);            // Freeze again replaces it
  await expect(page.locator('#frozenLabel')).toContainText('Transverse');
  await page.locator('#unfreeze').click(); await idle(page);
  await expect(page.locator('#frozen')).toBeHidden();
});

test('a click on the frozen map adds a point @desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(APP);
  await page.locator('#freeze').click(); await idle(page);
  const box = await page.locator('#frozen').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + 20 + (box.height - 20) / 2);   // map center: 0°, 0°
  await expect(page.locator('#from')).toHaveValue(/0\.\d+°/);
});

test('Cylinder along this route: the cylinder touches along the route, so its great circle is straight', async ({ page }) => {
  await page.goto(APP + BOS_ROM);
  await page.locator('#routes .along').first().click(); await idle(page);
  await expect(page.locator('#touch')).toHaveText('Along Boston → Rome · touches the route');
  await expect(page.locator('#st2')).toHaveAttribute('aria-pressed', 'true');
});

test('fits a phone: nothing scrolls sideways', async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator(READY).first()).toBeVisible();
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
