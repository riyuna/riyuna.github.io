'use strict';
// 브라우저 웹 워커: 조회 테이블 만들기, 1억 개 구간 스윕(lib/worker.js의 createSweeper를 그대로 사용)
importScripts('randle-core.js?v=' + new URL(self.location.href).searchParams.get('v'));
const { createSweeper } = RandleCore.require('worker');
const { buildTables } = RandleCore.require('tables');
let sweeper = null;

// 일반 배열을 SharedArrayBuffer로 옮겨 모든 워커가 같은 메모리를 보게 한다
function share(tables) {
  const out = {};
  for (const [name, a] of Object.entries(tables)) {
    const sab = new SharedArrayBuffer(a.byteLength);
    new Uint8Array(sab).set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    out[name] = sab;
  }
  return out;
}

self.onmessage = e => {
  const msg = e.data;
  try {
    let res;
    if (msg.task === 'init') { sweeper = createSweeper({ raw: msg.raw, config: msg.config }, msg.tables); res = true; }
    else if (msg.task === 'tables') res = share(buildTables(msg.raw, text => self.postMessage({ log: text })));
    else if (msg.task === 'build') res = sweeper.runBuild(msg);
    else if (msg.task === 'query') res = sweeper.runQuery(msg);
    else throw new Error('알 수 없는 작업: ' + msg.task);
    self.postMessage({ id: msg.id, ok: true, res });
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String((err && err.stack) || err) });
  }
};
