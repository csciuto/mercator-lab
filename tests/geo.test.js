// Unit tests for the geodesy in geo.js: run with `node --test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../geo.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);
const BOS = [-71.06, 42.36], MOS = [37.62, 55.76], LON = [-0.13, 51.51], SYD = [151.21, -33.87];

test('one degree of the equator is 2πR/360', () => {
  near(G.gcDist([0, 0], [1, 0]), 2 * Math.PI * G.R_KM / 360, 1e-6);
});

test('great circle is never longer than the rhumb line', () => {
  for (const [a, b] of [[BOS, MOS], [LON, SYD], [[-120, 10], [150, 40]]]) {
    assert.ok(G.gcDist(a, b) <= G.rhumb(a, b).d + 1e-6);
  }
  assert.ok(G.rhumb(BOS, MOS).d - G.gcDist(BOS, MOS) > 300, 'Boston–Moscow: rhumb is hundreds of km longer');
});

test('along the equator or a meridian the two lines agree', () => {
  near(G.rhumb([10, 0], [40, 0]).d, G.gcDist([10, 0], [40, 0]), 1e-6, 'equator');
  near(G.rhumb([20, -30], [20, 50]).d, G.gcDist([20, -30], [20, 50]), 1e-6, 'meridian');
});

test('bearings: due east on the equator, due north up a meridian', () => {
  near(G.gcBearing([0, 0], [10, 0]), 90, 1e-9);
  near(G.gcBearing([5, 10], [5, 40]), 0, 1e-9);
  near(G.rhumb([0, 0], [10, 0]).brg, 90, 1e-9);
});

test('rhumb lines take the short way across the antimeridian', () => {
  const r = G.rhumb([170, 0], [-170, 0]);
  near(r.d, G.gcDist([170, 0], [-170, 0]), 1e-6);
  near(r.brg, 90, 1e-9);
});

test('interpolation hits both endpoints', () => {
  for (const at of [G.gcInterp, (a, b, t) => G.rhumbAt(a, b, t)]) {
    const s = at(BOS, MOS, 0), e = at(BOS, MOS, 1);
    near(s[0], BOS[0], 1e-9); near(s[1], BOS[1], 1e-9);
    near(e[0], MOS[0], 1e-9); near(e[1], MOS[1], 1e-9);
  }
  const mid = G.gcInterp([0, 0], [90, 0], 0.5);
  near(mid[0], 45, 1e-9); near(mid[1], 0, 1e-9);
});

test('longitude wrapping and latitude clamping', () => {
  assert.equal(G.wrapLon(190), -170);
  assert.equal(G.wrapLon(-190), 170);
  assert.deepEqual(G.clampCoord([200, 89]), [-160, G.MAXLAT]);
});

test('labels: nearest within radius, overlapping boxes dropped', () => {
  const pts = [{ x: 0, y: 0 }, { x: 8, y: 0 }];
  assert.equal(G.nearest(pts, 7, 0, 10), pts[1]);
  assert.equal(G.nearest(pts, 50, 50, 10), null);
  const kept = G.placeLabels([{ x0: 0, x1: 10, y0: 0, y1: 10 }, { x0: 5, x1: 15, y0: 5, y1: 15 }, { x0: 20, x1: 30, y0: 0, y1: 10 }]);
  assert.equal(kept.length, 2);
});

test('distance label shows miles and kilometres', () => {
  assert.equal(G.distLabel(1000), '621 mi · 1,000 km');
});
