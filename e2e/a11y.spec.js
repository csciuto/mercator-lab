const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

for (const [name, path, ready] of [['Mercator Lab', '/#routes=-71.06,42.36,12.5,41.9', '#routes li'], ['Help', '/help.html', 'h1']]) {
  test(`${name}: no accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator(ready).first()).toBeVisible();
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.nodes[0].target}`)).toEqual([]);
  });
}
