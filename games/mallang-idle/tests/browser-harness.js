/*
 * 실브라우저 테스트 공용 하니스 — 의존성 없는 헤드리스 Chrome/Edge + CDP.
 *
 * 정적 테스트가 못 잡는 부류(computed style, 실좌표 클릭, 탭 간 상호작용)를
 * 저장소 안에서 재현 가능하게 만든다. Node 22+ 내장 WebSocket 사용.
 *
 *   var H = require('./browser-harness.js');
 *   H.withPage(async function (pg) { ... pg.eval / pg.click ... });
 *
 * 브라우저가 없는 환경에서는 withPage 가 'SKIPPED' 를 출력하고 0 으로 종료한다.
 */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');
var childProcess = require('child_process');

var ROOT = path.join(__dirname, '..', '..', '..');   // 저장소 루트 (/games, /shared 서빙)

var BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  process.env.CHROME_PATH || '',
].filter(Boolean);

var MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.json': 'application/json',
};

function serveStatic() {
  return new Promise(function (resolve) {
    var server = http.createServer(function (req, res) {
      var p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      var file = path.join(ROOT, p);
      if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, function (err, data) {
        if (err) { res.writeHead(404); return res.end('not found: ' + p); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', function () { resolve(server); });
  });
}

function launchBrowser(exe, profileDir) {
  return new Promise(function (resolve, reject) {
    var proc = childProcess.spawn(exe, [
      '--headless=new', '--remote-debugging-port=0',
      '--user-data-dir=' + profileDir,
      '--no-first-run', '--no-default-browser-check', '--disable-gpu',
      '--force-device-scale-factor=1', '--window-size=390,900',
      '--mute-audio', 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    var buf = '';
    var timer = setTimeout(function () { reject(new Error('DevTools endpoint timeout\n' + buf)); }, 15000);
    proc.stderr.on('data', function (d) {
      buf += d;
      var m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) { clearTimeout(timer); resolve({ proc: proc, wsUrl: m[1] }); }
    });
    proc.on('error', function (e) { clearTimeout(timer); reject(e); });
  });
}

/* 최소 CDP 클라이언트 — flat 프로토콜(sessionId 라우팅) */
function cdp(wsUrl) {
  return new Promise(function (resolve, reject) {
    var ws = new WebSocket(wsUrl);
    var id = 0, pending = {};
    ws.onopen = function () {
      resolve({
        send: function (method, params, sessionId) {
          return new Promise(function (res, rej) {
            var msg = { id: ++id, method: method, params: params || {} };
            if (sessionId) msg.sessionId = sessionId;
            pending[msg.id] = { res: res, rej: rej };
            ws.send(JSON.stringify(msg));
          });
        },
        close: function () { try { ws.close(); } catch (e) {} },
      });
    };
    ws.onmessage = function (ev) {
      var m = JSON.parse(ev.data);
      if (m.id && pending[m.id]) {
        var p = pending[m.id];
        delete pending[m.id];
        if (m.error) p.rej(new Error(m.error.message));
        else p.res(m.result);
      }
    };
    ws.onerror = function () { reject(new Error('CDP websocket error')); };
  });
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* 페이지 하나를 띄우고 fn(pg) 를 실행한다. pg:
 *   origin       — http://127.0.0.1:PORT
 *   eval(expr)   — Runtime.evaluate (returnByValue)
 *   click(x, y)  — 실좌표 마우스 클릭
 *   clickEl(id)  — 요소 중심 실좌표 클릭
 *   sleep(ms)
 */
function withPage(pagePath, fn) {
  var exe = BROWSERS.find(function (p) { return fs.existsSync(p); });
  if (!exe) {
    console.log('SKIPPED — Chrome/Edge 를 찾지 못했습니다 (CHROME_PATH 로 지정 가능)');
    process.exit(0);
  }

  return (async function () {
    var server = await serveStatic();
    var origin = 'http://127.0.0.1:' + server.address().port;
    var profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mallang-idle-e2e-'));
    var browser = null, client = null;

    try {
      browser = await launchBrowser(exe, profile);
      client = await cdp(browser.wsUrl);
      var t = await client.send('Target.createTarget', { url: origin + pagePath });
      var att = await client.send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
      var sid = att.sessionId;
      await client.send('Runtime.enable', {}, sid);
      await client.send('Page.enable', {}, sid);

      var pg = {
        origin: origin,
        sleep: sleep,
        eval: async function (expr) {
          var r = await client.send('Runtime.evaluate', {
            expression: expr, returnByValue: true, awaitPromise: true,
          }, sid);
          if (r.exceptionDetails) {
            throw new Error('page eval failed: ' + JSON.stringify(r.exceptionDetails.exception));
          }
          return r.result.value;
        },
        click: async function (x, y) {
          await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x, y: y, button: 'left', clickCount: 1 }, sid);
          await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x, y: y, button: 'left', clickCount: 1 }, sid);
        },
        screenshot: async function () {
          var r = await client.send('Page.captureScreenshot', { format: 'png' }, sid);
          return r.data;   // base64
        },
      };
      pg.clickEl = async function (domId) {
        var r = JSON.parse(await pg.eval(
          '(function(){var r=document.getElementById(' + JSON.stringify(domId) + ').getBoundingClientRect();' +
          'return JSON.stringify({x:r.left+r.width/2, y:r.top+r.height/2});})()'));
        await pg.click(r.x, r.y);
      };

      await fn(pg);
    } finally {
      if (client) client.close();
      if (browser) try { browser.proc.kill(); } catch (e) {}
      server.close();
      setTimeout(function () {
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
      }, 500);
    }
  })();
}

module.exports = { withPage: withPage, sleep: sleep };
