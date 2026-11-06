const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

for (const [name, path, ready] of [['Routes', '/', '#map path.land'], ['Unroll the globe', '/unroll/', '#measList li'], ['Help', '/help.html', 'h1']]) {
  test(`${name}: no accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator(ready).first()).toBeVisible();
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.nodes[0].target}`)).toEqual([]);
  });
}
