'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var rules = fs.readFileSync(path.join(root, 'engine', 'rules.js'), 'utf8');
var ui = fs.readFileSync(path.join(root, 'engine', 'ui.js'), 'utf8');

var tests = [];
function test(name, fn) { tests.push({ name:name, fn:fn }); }

test('index keeps zoom enabled and 44px-class board cells', function () {
  assert(html.includes('width=device-width, initial-scale=1.0, viewport-fit=cover'));
  assert(!html.includes('user-scalable=no'));
  assert(html.includes('--cell:clamp(44px,11vw,46px);'));
});

test('index exposes tactical legibility controls and objective hud', function () {
  ['objectiveText', 'forecast', 'btnThreat', 'btnCancel', 'btnConfirm', 'btnWait', 'btnEnd'].forEach(function (id) {
    assert(html.includes('id="' + id + '"'));
  });
});

test('index loads only external runtime scripts and no legacy inline prototype blob', function () {
  assert(html.includes('<script src="./engine/rules.js"></script>'));
  assert(html.includes('<script src="./engine/ui.js"></script>'));
  assert(!html.includes('phase0LegacySource'));
  assert(!html.includes('<script>'));
});

test('ui keeps dom references outside serializable battle state', function () {
  assert(!rules.includes('document.'));
  assert(!rules.includes('Math.random'));
  assert(ui.includes('var unitEls = Object.create(null);'));
  assert(!ui.includes('hpEl'));
  assert(!ui.includes('el: null'));
  assert(!ui.includes('hpBar: null'));
});

test('ui is prewired to the Claude asset contract with emoji fallback', function () {
  [
    './assets/units/latte-guardian.png',
    './assets/units/mint-starlight.png',
    './assets/enemies/squeakbot.png',
    './assets/enemies/bearbot.png'
  ].forEach(function (asset) { assert(ui.includes(asset)); });
  assert(ui.includes('token-fallback'));
  assert(ui.includes("image.addEventListener('error'"));
});

var failed = 0;
tests.forEach(function (item) {
  try { item.fn(); console.log('ok - ' + item.name); }
  catch (error) { failed += 1; console.error('not ok - ' + item.name); console.error(error.stack); }
});
if (failed) process.exitCode = 1;
else console.log('passed ' + tests.length + ' tests');
