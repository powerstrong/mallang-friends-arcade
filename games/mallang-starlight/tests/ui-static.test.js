'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var ui = fs.readFileSync(path.join(root, 'engine', 'ui.js'), 'utf8');
var engine = fs.readFileSync(path.join(root, 'engine', 'puzzle.js'), 'utf8');
var puzzles = fs.readFileSync(path.join(root, 'data', 'puzzles.js'), 'utf8');
var manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
var tests = [];
function test(n, f) { tests.push({ n: n, f: f }); }

test('mobile viewport keeps zoom enabled and touch targets large', function () {
  assert(/width=device-width,\s*initial-scale=1/.test(html));
  assert(!html.includes('user-scalable=no'));
  assert(html.includes('min-height:48px') || html.includes('min-height: 48px'));
});
test('runtime scripts are external, ordered, and shared shell connected', function () {
  ['../../games/registry.js', '../../shared/bootstrap.js', './data/puzzles.js', './engine/puzzle.js', './engine/ui.js'].forEach(function (src) {
    assert(html.includes('<script src="' + src + '"></script>'), 'missing ' + src);
  });
  assert(!html.includes('<script>'), 'no inline scripts');
  assert(ui.includes('window.GameBoot.submitResult'));
  assert(ui.includes('window.__mallangStarlight'));
});
test('pure engine boundary is preserved (no DOM / no Math.random in engine)', function () {
  assert(!engine.includes('document.'));
  assert(!engine.includes('Math.random'));
  assert(engine.includes('root.MallangPuzzle = api'));
  assert(puzzles.includes('root.MallangPuzzles = api'));
});
test('save schema is v3 and localStorage wired', function () {
  assert(ui.includes("SAVE_KEY = 'mallang-starlight-save-v3'"));
  assert(ui.includes('localStorage.setItem'));
});
test('core screens and controls exist', function () {
  ['homeScreen', 'battleScreen', 'resultScreen', 'board', 'btnGo', 'btnUndo', 'btnRestart', 'slotLatte', 'slotMint', 'howDialog', 'menuDialog'].forEach(function (id) {
    assert(html.includes('id="' + id + '"'), 'missing #' + id);
  });
});
test('shipped runtime art referenced by html/data exists', function () {
  ['./assets/runtime/ui/hub-bg.webp', './assets/runtime/ui/result-sticker.webp', './assets/runtime/ui/icon-192.png'].forEach(function (a) {
    assert(html.includes(a), 'missing ' + a);
    assert(fs.existsSync(path.join(root, a.replace(/^\.\//, ''))), 'missing file ' + a);
  });
  ['assets/runtime/tokens/latte.webp', 'assets/runtime/tokens/mint.webp', 'assets/runtime/tokens/enemy-turret.webp'].forEach(function (a) {
    assert(puzzles.includes(a), 'missing ' + a);
    assert(fs.existsSync(path.join(root, a)), 'missing file ' + a);
  });
});
test('manifest exposes install metadata and icons', function () {
  assert.strictEqual(manifest.display, 'standalone');
  assert(manifest.icons.some(function (i) { return i.sizes === '192x192'; }));
  assert(manifest.icons.some(function (i) { return i.sizes === '512x512'; }));
});

var failed = 0;
tests.forEach(function (t) { try { t.f(); console.log('ok - ' + t.n); } catch (e) { failed += 1; console.error('not ok - ' + t.n); console.error(e.message); } });
if (failed) process.exitCode = 1; else console.log('passed ' + tests.length + ' tests');
