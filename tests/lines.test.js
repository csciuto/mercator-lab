// Routes in the address: run with `node --test`.
const test = require('node:test');
const assert = require('node:assert/strict');
global.clampCoord = require('../geo.js').clampCoord;  // lines.js expects geo.js loaded first, as in the pages
const { encodeLines, decodeLines, linesFromHash, linesHash, routesHash, routesFromHash, viewHash, turnFromHash, circlesFromHash } = require('../lines.js');
global.linesFromHash = linesFromHash;

const BOS = [-71.06, 42.36], MOS = [37.62, 55.76];

test('round trip keeps type and coordinates', () => {
  const lines = [{ type: 'gc', a: BOS, b: MOS }, { type: 'rh', a: [151.2093, -33.8688], b: [-0.1276, 51.5072] }];
  const got = decodeLines(encodeLines(lines));
  assert.deepEqual(got.map((L) => L.type), ['gc', 'rh']);
  got.forEach((L, i) => [...L.a, ...L.b].forEach((v, j) => {
    assert.ok(Math.abs(v - [...lines[i].a, ...lines[i].b][j]) < 1e-9);  // wrapping adds float noise only
  }));
});

test('no routes in the address means null (show examples); an empty list is still a list', () => {
  assert.equal(linesFromHash(''), null);
  assert.equal(linesFromHash('#other=1'), null);
  assert.deepEqual(linesFromHash(linesHash([])), []);
});

test('bad pieces are dropped, out-of-range coordinates clamped', () => {
  const got = decodeLines('gc:1,2,3,4;zz:1,2,3,4;rh:1,2,3;rh:200,89,0,0');
  assert.deepEqual(got.map((L) => L.type), ['gc', 'rh']);
  assert.equal(got[1].a[0], -160);
  assert.ok(got[1].a[1] < 85.1);
});

test('reads routes alongside other address parts, URL-escaped or not', () => {
  const h = linesHash([{ type: 'gc', a: BOS, b: MOS }]);
  assert.equal(linesFromHash('#x=1&' + h.slice(1)).length, 1);
  assert.equal(linesFromHash('#lines=' + encodeURIComponent('gc:1,2,3,4')).length, 1);
});

test('routes round-trip; old #lines= links collapse their pairs into one route', () => {
  const r = routesFromHash(routesHash([{ a: BOS, b: MOS }, { a: [151.2093, -33.8688], b: [-0.1276, 51.5072] }]));
  assert.equal(r.length, 2);
  assert.ok(Math.abs(r[0].a[0] - BOS[0]) < 1e-9 && Math.abs(r[1].b[1] - 51.5072) < 1e-9);
  assert.equal(routesFromHash(''), null);
  assert.deepEqual(routesFromHash('#routes='), []);
  assert.equal(routesFromHash('#lines=gc:-71.06,42.36,37.62,55.76;rh:37.62,55.76,-71.06,42.36').length, 1);
  assert.equal(routesFromHash('#routes=1,2,3;4,5,6,7').length, 1);
});

test('the whole view goes in the address: routes, both turns and the circles; the starting view is a clean address', () => {
  const routes = [{ a: BOS, b: MOS }];
  assert.equal(viewHash([], [0, 0, 0], [0, 0, 0], false), '');
  assert.equal(viewHash([], [0.04, -0.04, 0], [0, 0, 0], false), '');                 // sliders show one decimal: this is at rest
  assert.equal(viewHash(routes, [0, 0, 0], [0, 0, 0], false), routesHash(routes));    // routes alone: the address as it always was
  const h = viewHash(routes, [12.34, -5, 0], [0, 0, -90], true);
  assert.equal(h, '#routes=-71.06,42.36,37.62,55.76&g=12.3,-5,0&c=0,0,-90&circles');
  assert.deepEqual(routesFromHash(h).map((r) => r.a), [BOS]);
  assert.deepEqual(turnFromHash(h, 'g'), [12.3, -5, 0]);
  assert.deepEqual(turnFromHash(h, 'c'), [0, 0, -90]);
  assert.equal(circlesFromHash(h), true);
  assert.equal(viewHash([], [0, 0, 0], [0, 0, -45], false), '#c=0,0,-45');
});

test('turns in the address are checked: absent, malformed or out of range', () => {
  assert.equal(turnFromHash('', 'g'), null);
  assert.equal(turnFromHash('#routes=1,2,3,4', 'g'), null);
  assert.equal(turnFromHash('#g=1,2', 'g'), null);
  assert.equal(turnFromHash('#g=a,b,c', 'g'), null);
  assert.deepEqual(turnFromHash('#g=999,-999,181', 'g'), [180, -90, 180]);
  assert.equal(turnFromHash('#cg=1,2,3', 'g'), null);                                // not a g= part
  assert.equal(circlesFromHash('#routes=1,2,3,4'), false);
  assert.equal(circlesFromHash('#circles'), true);
  assert.equal(circlesFromHash('#circlesx'), false);
});
