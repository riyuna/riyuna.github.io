'use strict';
// 브라우저 엔진: 웹 워커 풀 + SharedArrayBuffer + IndexedDB 캐시.
// Node의 lib/engine.js와 같은 일을 한다. 처음 한 번 조회 테이블과 기본 점수표(1억 개)를 만들어 브라우저에 저장해 두고,
// 판마다 직전 판 문맥 점수표를 워커들이 나눠 계산한다.
(function (g) {
  const { chunks, mergeBuild, mergeQuery, statsFromBuild } = RandleCore.require('sweepplan');
  const { buildMeta } = RandleCore.require('meta');
  const N = 1e8;
  const F0_PIECE = 25e6; // IndexedDB에 나눠 저장할 바이트 단위

  class Pool {
    constructor(n, url) {
      this.workers = [];
      this.idle = [];
      this.queue = [];
      this.pending = new Map();
      this.seq = 0;
      this.onLog = null;
      for (let i = 0; i < n; i++) {
        const w = new Worker(url);
        w.onmessage = e => {
          const msg = e.data;
          if (msg.log !== undefined) { if (this.onLog) this.onLog(msg.log); return; }
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (!p.direct) { this.idle.push(w); this.pump(); }
          if (msg.ok) p.resolve(msg.res);
          else p.reject(new Error(msg.error));
        };
        w.onerror = e => {
          const err = new Error(e.message || '워커 오류');
          for (const p of this.pending.values()) p.reject(err);
          this.pending.clear();
        };
        this.workers.push(w);
        this.idle.push(w);
      }
    }
    run(msg) {
      return new Promise((resolve, reject) => {
        this.queue.push({ msg: { ...msg, id: ++this.seq }, resolve, reject });
        this.pump();
      });
    }
    // 모든 워커에 같은 메시지(초기화용)
    broadcast(msg) {
      return Promise.all(this.workers.map(w => new Promise((resolve, reject) => {
        const id = ++this.seq;
        this.pending.set(id, { resolve, reject, direct: true });
        w.postMessage({ ...msg, id });
      })));
    }
    pump() {
      while (this.idle.length && this.queue.length) {
        const w = this.idle.pop(), job = this.queue.shift();
        this.pending.set(job.msg.id, job);
        w.postMessage(job.msg);
      }
    }
    close() { for (const w of this.workers) w.terminate(); }
  }

  // ---------- IndexedDB ----------
  const DB = 'randle-helper', STORE = 'kv';
  const req2p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  function openDB() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  const tx = (db, mode) => db.transaction(STORE, mode).objectStore(STORE);
  const get = (db, k) => req2p(tx(db, 'readonly').get(k));
  const put = (db, k, v) => req2p(tx(db, 'readwrite').put(v, k));
  const clear = db => req2p(tx(db, 'readwrite').clear());

  const toShared = buf => { const sab = new SharedArrayBuffer(buf.byteLength); new Uint8Array(sab).set(new Uint8Array(buf)); return sab; };

  async function loadCache(db, key, onProgress) {
    const head = await get(db, 'head');
    if (!head || head.key !== key) return null;
    onProgress({ stage: 'load', done: 0, total: head.pieces + head.tables.length });
    const tables = {};
    let done = 0;
    for (const name of head.tables) {
      const buf = await get(db, 'tbl:' + name);
      if (!buf) return null;
      tables[name] = toShared(buf);
      onProgress({ stage: 'load', done: ++done, total: head.pieces + head.tables.length });
    }
    const F0 = new SharedArrayBuffer(N * 4), view = new Uint8Array(F0);
    for (let i = 0; i < head.pieces; i++) {
      const buf = await get(db, 'f0:' + i);
      if (!buf) return null;
      view.set(new Uint8Array(buf), i * F0_PIECE);
      onProgress({ stage: 'load', done: ++done, total: head.pieces + head.tables.length });
    }
    const stats = await get(db, 'stats');
    return stats ? { tables, F0, stats } : null;
  }

  async function saveCache(db, key, tables, F0, stats, onProgress) {
    await clear(db);
    const names = Object.keys(tables), pieces = Math.ceil((N * 4) / F0_PIECE);
    let done = 0;
    for (const name of names) {
      await put(db, 'tbl:' + name, new Uint8Array(tables[name]).slice().buffer);
      onProgress({ stage: 'save', done: ++done, total: names.length + pieces });
    }
    const view = new Uint8Array(F0);
    for (let i = 0; i < pieces; i++) {
      await put(db, 'f0:' + i, view.slice(i * F0_PIECE, Math.min((i + 1) * F0_PIECE, view.length)).buffer);
      onProgress({ stage: 'save', done: ++done, total: names.length + pieces });
    }
    await put(db, 'stats', stats);
    await put(db, 'head', { key, tables: names, pieces }); // 마지막에 써야 반쯤 저장된 캐시를 쓰지 않는다
  }

  class WebEngine {
    constructor({ version, cacheKey, workers }) {
      this.version = version;
      this.cacheKey = cacheKey || version;
      this.nWorkers = Math.max(2, Math.min(workers || navigator.hardwareConcurrency || 4, 16));
      this.workerUrl = 'worker.js?v=' + encodeURIComponent(version);
      this.onQueryProgress = null;
    }

    // onProgress({stage: 'load'|'tables'|'build'|'save', done, total, text})
    async init(raw, config, onProgress = () => {}) {
      this.meta = buildMeta(raw, config);
      const key = [this.cacheKey, 'f1', raw.date, config.mijeong].join('|'); // f1: 저장 형식
      let db = null;
      try { db = await openDB(); } catch (e) { console.warn('IndexedDB를 쓸 수 없어 캐시 없이 계산합니다', e); }
      const cached = db ? await loadCache(db, key, onProgress).catch(e => { console.warn(e); return null; }) : null;
      if (cached) {
        this.tables = cached.tables;
        this.stats = cached.stats;
        this.F0 = cached.F0;
      } else {
        onProgress({ stage: 'tables', text: '' });
        const tp = new Pool(1, this.workerUrl);
        tp.onLog = text => onProgress({ stage: 'tables', text });
        this.tables = await tp.run({ task: 'tables', raw });
        tp.close();
      }
      this.pool = new Pool(this.nWorkers, this.workerUrl);
      await this.pool.broadcast({ task: 'init', raw, config, tables: this.tables });
      if (!cached) {
        this.F0 = new SharedArrayBuffer(N * 4);
        const parts = chunks();
        let done = 0;
        onProgress({ stage: 'build', done, total: parts.length });
        const results = await Promise.all(parts.map(([lo, hi]) =>
          this.pool.run({ task: 'build', lo, hi, F0: this.F0, validateDate: String(this.meta.date) })
            .then(r => { onProgress({ stage: 'build', done: ++done, total: parts.length }); return r; })));
        this.stats = statsFromBuild(this.meta, mergeBuild(results));
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
        if (db) await saveCache(db, key, this.tables, this.F0, this.stats, onProgress).catch(e => console.warn('캐시 저장 실패', e));
      }
      this.T = new SharedArrayBuffer(N * 4);
      return { cached: !!cached };
    }

    async query(q) {
      const parts = chunks();
      let done = 0;
      const report = () => { if (this.onQueryProgress) this.onQueryProgress(done, parts.length); };
      report();
      const results = await Promise.all(parts.map(([lo, hi]) =>
        this.pool.run({ task: 'query', lo, hi, F0: this.F0, T: this.T, ...q }).then(r => { done++; report(); return r; })));
      return { T: new Float32Array(this.T), ...mergeQuery(results) };
    }

    static async clearCache() {
      const db = await openDB();
      await clear(db);
    }
  }

  g.WebEngine = WebEngine;
})(self);
