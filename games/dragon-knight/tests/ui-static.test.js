'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var rules = fs.readFileSync(path.join(root, 'engine', 'rules.js'), 'utf8');
var ui = fs.readFileSync(path.join(root, 'engine', 'ui.js'), 'utf8');
var missions = fs.readFileSync(path.join(root, 'data', 'missions.js'), 'utf8');
var manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).reduce(function (out, entry) {
    var target = path.join(dir, entry.name);
    return out.concat(entry.isDirectory() ? filesUnder(target) : [target]);
  }, []);
}

test('mobile viewport keeps zoom enabled and touch targets large', function () {
  assert(/width=device-width,\s*initial-scale=1(?:\.0)?,\s*viewport-fit=cover/.test(html));
  assert(!html.includes('user-scalable=no'));
  assert(html.includes('--cell: clamp(44px'));
  assert(html.includes('min-height: 48px'));
});
test('campaign, briefing, battle, result, pause, and help surfaces exist', function () {
  ['homeScreen','briefScreen','battleScreen','resultScreen','missionList','objectiveText','objectiveProgress','forecast','btnThreat','btnSkill','btnCancel','btnConfirm','btnWait','btnObjective','btnEnd','pauseDialog','helpDialog'].forEach(function (id) {
    assert(html.includes('id="' + id + '"'), 'missing #' + id);
  });
});
test('runtime scripts are external, ordered, and shared shell connected', function () {
  ['../../games/registry.js','../../shared/bootstrap.js','./data/missions.js','./engine/rules.js','./engine/ui.js'].forEach(function (src) {
    assert(html.includes('<script src="' + src + '"></script>'), 'missing ' + src);
  });
  assert(!html.includes('<script>'));
  assert(ui.includes('M.listMissions()'));
  assert(ui.includes('window.GameBoot.submitResult'));
});
test('serializable autosave and DOM-free rules boundary are preserved', function () {
  assert(!rules.includes('document.'));
  assert(!rules.includes('Math.random'));
  assert(ui.includes("var SAVE_KEY = 'mallang-starlight-save-v2'"));
  assert(ui.includes('state: R.clone(state)'));
  assert(ui.includes('localStorage.setItem'));
  assert(ui.includes('var unitEls = Object.create(null)'));
});
test('autosave never strands a resumed battle inside an inert enemy phase', function () {
  assert(ui.includes("state.status !== 'active' || state.phase !== 'you'"));
  assert(ui.includes("if (state.phase === 'foe') window.setTimeout(enemyPhase, 0)"));
  var enemyPhaseBody = ui.slice(ui.indexOf('function enemyPhase()'), ui.indexOf('function endEnemyPhase()'));
  assert(enemyPhaseBody.includes("if (state.phase === 'you') state = R.endPhase(state)"));
  assert(enemyPhaseBody.includes("if (state.phase !== 'foe')"));
  assert(!enemyPhaseBody.includes('saveBattle('));
});
test('optimized runtime art is wired through html and mission data', function () {
  ['./assets/runtime/ui/hub-bg.webp','./assets/runtime/ui/result-sticker.webp','./assets/runtime/ui/icon-192.png'].forEach(function (asset) {
    assert(html.includes(asset), 'missing ' + asset);
  });
  ['assets/runtime/tokens/latte.webp','assets/runtime/tokens/mint.webp','assets/runtime/tokens/boss-bear.webp'].forEach(function (asset) {
    assert(missions.includes(asset), 'missing ' + asset);
  });
  assert(ui.includes('token-fallback'));
  assert(ui.includes("image.addEventListener('error'"));
});
test('every shipped runtime image has a real consumer', function () {
  var consumers = [html, ui, missions, JSON.stringify(manifest)].join('\n');
  var shipped = filesUnder(path.join(root, 'assets', 'runtime')).filter(function (file) {
    return /\.(?:png|webp|jpe?g|gif|svg)$/i.test(file);
  });
  shipped.forEach(function (file) {
    var relative = path.relative(root, file).split(path.sep).join('/');
    assert(consumers.includes(relative), 'orphan runtime image: ' + relative);
  });
  var references = consumers.match(/(?:\.\/)?assets\/runtime\/[A-Za-z0-9_./-]+\.(?:png|webp|jpe?g|gif|svg)/gi) || [];
  references.forEach(function (reference) {
    var relative = reference.replace(/^\.\//, '');
    assert(fs.existsSync(path.join(root, relative)), 'missing runtime image: ' + relative);
  });
});
test('accessibility includes focus, reduced motion, dialogs, and a non-color threat cue', function () {
  assert(html.includes(':focus-visible'));
  assert(html.includes('prefers-reduced-motion: reduce'));
  assert(html.includes('<dialog id="pauseDialog">'));
  assert(html.includes('aria-live="assertive"'));
  assert(html.includes('.cell.threat::before'));
  assert(html.includes('content: "!"'));
});
test('manifest exposes install metadata and required icon sizes', function () {
  assert.strictEqual(manifest.display, 'standalone');
  assert.strictEqual(manifest.start_url, './index.html');
  assert(manifest.icons.some(function (icon) { return icon.sizes === '192x192'; }));
  assert(manifest.icons.some(function (icon) { return icon.sizes === '512x512'; }));
});

var failed = 0;
tests.forEach(function (item) {
  try { item.fn(); console.log('ok - ' + item.name); }
  catch (error) { failed += 1; console.error('not ok - ' + item.name); console.error(error.stack); }
});
if (failed) process.exitCode = 1;
else console.log('passed ' + tests.length + ' tests');
