// Routes in the address: run with `node --test`.
const test = require('node:test');
const assert = require('node:assert/strict');
global.clampCoord = require('../geo.js').clampCoord;  // lines.js expects geo.js loaded first, as in the pages
const { encodeLines, decodeLines, linesFromHash, linesHash } = require('../lines.js');

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
