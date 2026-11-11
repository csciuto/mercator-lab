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
// where an Earth point lands on the wall map (canvas pixels)
const onWall = (page, c) => page.evaluate((c) => window.__lab.wall()(c), c);
// screen position of an Earth point on the globe
const screenOf = (page, c) => page.evaluate(([lon, lat]) => {
  const S = window.__lab.S;
  const g = mv(S.G, vec(lon, lat));
  return window.__lab.screenOf([g[1], g[2], g[0]]);
}, c);

test('opens on the globe in its cylinder, with the wall map beside it @desktop', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.goto(APP + (process.env.UPDATE_PREVIEW ? BOS_ROM + ';-0.13,51.51,139.69,35.69' : ''));
  await expect(page.locator('#live canvas')).toBeVisible();
  await expect(page.locator('#wall')).toBeVisible();
  await expect(page.locator(READY).first()).toBeVisible();
  await idle(page);
  const c = await counts(page);
  expect(c.wire).toBeGreaterThan(0);
  expect(c.coast).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__lab.map())).toEqual({ visible: true, opacity: 0.85 });
  await expect(page.locator('#st0, #st2, #st3, #freeze')).toHaveCount(0);   // no steps, no Freeze
  expect(errors).toEqual([]);
  if (process.env.UPDATE_PREVIEW) {
    await page.waitForTimeout(500);
    await page.screenshot({ path: PREVIEW });
    await page.setViewportSize({ width: 1200, height: 740 });
    await idle(page); await page.waitForTimeout(500);
    await page.locator('#bench').screenshot({ path: 'help-map.png' });
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
  await idle(page);
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

test('Globe and Cylinder opacity are separate; at 0 the fill goes and the outlines stay', async ({ page }) => {
  await page.goto(APP + BOS_ROM);
  await idle(page);
  await page.locator('#cylOpacity').fill('30'); await idle(page);
  expect((await page.evaluate(() => window.__lab.map())).opacity).toBeCloseTo(0.3);
  await page.locator('#opacity').fill('100'); await idle(page);
  expect((await page.evaluate(() => window.__lab.globe())).opacity).toBeCloseTo(1);
  expect((await page.evaluate(() => window.__lab.map())).opacity).toBeCloseTo(0.3);
  await page.locator('#cylOpacity').fill('0'); await idle(page);
  expect((await page.evaluate(() => window.__lab.map())).visible).toBe(false);
  const c = await counts(page);
  expect(c.coast).toBeGreaterThan(0);                   // country outlines stay on the cylinder
  expect(c.wire).toBeGreaterThan(0);                    // and so does its wireframe
  await expect(page.locator('#wall')).toBeVisible();   // and so does the wall map
});

test('the wall map follows the cylinder: Transverse redraws it', async ({ page }) => {
  await page.goto(APP + BOS_ROM);
  await idle(page);
  const before = await onWall(page, [-71.06, 42.36]);
  await page.locator('#pr-trans').click(); await idle(page);
  await expect(page.locator('#touch')).toHaveText('Transverse · touches the 0° meridian');
  const after = await onWall(page, [-71.06, 42.36]);
  expect(Math.hypot(after[0] - before[0], after[1] - before[1])).toBeGreaterThan(20);
  await page.locator('#g0').fill('40'); await idle(page);   // turning the globe redraws it too
  const turned = await onWall(page, [-71.06, 42.36]);
  expect(Math.hypot(turned[0] - after[0], turned[1] - after[1])).toBeGreaterThan(20);
});

test('a click on the wall map adds a point @desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(APP);
  await idle(page);
  const box = await page.locator('#wall').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + 20 + (box.height - 20) / 2);   // map center: 0°, 0°
  await expect(page.locator('#from')).toHaveValue(/0\.\d+°/);
});

test('Reset puts the globe and cylinder back and keeps routes', async ({ page }) => {
  await page.goto(APP + BOS_ROM);
  await page.locator('#g0').fill('40');
  await page.locator('#pr-trans').click(); await idle(page);
  await page.locator('#cylOpacity').fill('20');
  await page.locator('#reset').click(); await idle(page);
  const S = await page.evaluate(() => ({ G: window.__lab.S.G, C: window.__lab.S.C, k: window.__lab.S.cylOpacity }));
  expect(Math.abs(S.G[0][0] - 1)).toBeLessThan(1e-6);
  expect(Math.abs(S.C[0][0] - 1)).toBeLessThan(1e-6);
  expect(S.k).toBe(0.85);
  await expect(page.locator('#touch')).toHaveText('Normal · touches the equator');
  await expect(page.locator(ROUTE)).toHaveCount(1);
});

test('Cylinder along this route: the cylinder touches along the route, so its great circle is straight', async ({ page }) => {
  await page.goto(APP + BOS_ROM);
  await page.locator('#routes .along').first().click(); await idle(page);
  await expect(page.locator('#touch')).toHaveText('Along Boston → Rome · touches the route');
  // on the wall map the great circle now runs along the center line
  const [a, b] = [await onWall(page, [-71.06, 42.36]), await onWall(page, [12.5, 41.9])];
  expect(Math.abs(a[1] - b[1])).toBeLessThan(2);
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

test('the address keeps the globe, the cylinder and the circles, and a link restores them @desktop', async ({ page, context }) => {
  await page.goto(APP);
  await expect(page.locator(READY).first()).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  await page.locator('#g0').fill('40');                       // spin the globe
  await page.locator('#pr-trans').click();                    // transverse cylinder
  await page.getByLabel('Distortion circles').check();
  await expect.poll(() => new URL(page.url()).hash, { timeout: 8000 }).toBe('#g=40,0,0&c=0,0,-90&circles');

  const other = await context.newPage();
  await other.goto(page.url());
  await expect(other.locator(READY).first()).toBeVisible();
  await expect(other.locator('#g0o')).toHaveText('40.0°');
  await expect(other.locator('#c2o')).toHaveText('-90.0°');
  await expect(other.getByLabel('Distortion circles')).toBeChecked();
  // Reset puts the globe and cylinder back; the address follows
  await other.locator('#reset').click();
  await expect.poll(() => new URL(other.url()).hash, { timeout: 8000 }).toBe('#circles');
  await other.getByLabel('Distortion circles').uncheck();
  await expect.poll(() => new URL(other.url()).hash, { timeout: 8000 }).toBe('');
});

test('distortion circles: alike on the globe, stretched toward the poles on the map @desktop', async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator(READY).first()).toBeVisible();
  await page.getByLabel('Distortion circles').check();
  await idle(page);
  const sizes = await page.evaluate(() => {
    const proj = d3.geoMercator().scale(100).translate([0, 0]);
    const height = lat => { const ring = TISSOT.coordinates.find(p => Math.abs(d3.geoCentroid({ type: 'Polygon', coordinates: p })[1] - lat) < 1)[0].map(c => proj(c)[1]); return Math.max(...ring) - Math.min(...ring); };
    const area = lat => d3.geoArea({ type: 'Polygon', coordinates: TISSOT.coordinates.find(p => Math.abs(d3.geoCentroid({ type: 'Polygon', coordinates: p })[1] - lat) < 1) });
    return { h0: height(0), h60: height(60), a0: area(0), a60: area(60), n: TISSOT.coordinates.length, shown: L.tissot.geometry.drawRange.count > 0 && tissotGlobe.visible };
  });
  expect(sizes.n).toBe(60);
  expect(sizes.a60 / sizes.a0).toBeCloseTo(1, 2);             // the same circle on the globe
  expect(sizes.h60 / sizes.h0).toBeCloseTo(2, 0);             // twice as tall on the map at 60 degrees: 1 / cos(60)
  expect(sizes.shown).toBe(true);
  await page.getByLabel('Distortion circles').uncheck();
  await idle(page);
  expect(await page.evaluate(() => L.tissot.geometry.drawRange.count === 0 && !tissotGlobe.visible)).toBe(true);
});

test('zooming in brings finer coastlines, zooming out goes back to the coarse set @desktop', async ({ page }) => {
  let fetched = 0;
  page.on('request', (r) => { if (r.url().endsWith('world-50m.json')) fetched++; });
  await page.goto(APP);
  await expect(page.locator(READY).first()).toBeVisible();
  await idle(page);
  expect(await page.evaluate(() => window.__lab.detail())).toBe('lo');
  expect(fetched).toBe(0);                                    // not fetched until it is needed
  const coarse = (await counts(page)).coast;
  const box = await page.locator('#live canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -200);        // zoom in
  await expect.poll(() => page.evaluate(() => window.__lab.detail())).toBe('hi');
  await idle(page);
  expect((await counts(page)).coast).toBeGreaterThan(coarse * 5);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 200);        // and out again
  await expect.poll(() => page.evaluate(() => window.__lab.detail())).toBe('lo');
  await idle(page);
  expect((await counts(page)).coast).toBe(coarse);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -200);
  await expect.poll(() => page.evaluate(() => window.__lab.detail())).toBe('hi');
  expect(fetched).toBe(1);                                    // kept after the first time
});
