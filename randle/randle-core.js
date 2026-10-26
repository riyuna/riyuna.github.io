/* randle-core.js — tools/build-web.js가 lib/에서 생성한 파일. 직접 고치지 마세요. */
(function (g) {
  'use strict';
  const unavailable = name => new Proxy({}, { get: (_, k) => () => { throw new Error(name + '.' + String(k) + '는 브라우저에서 쓸 수 없습니다'); } });
  const stubs = {
    fs: unavailable('fs'), vm: unavailable('vm'), crypto: unavailable('crypto'),
    path: { join: (...a) => a.join('/'), dirname: p => p, relative: (a, b) => b },
    os: { cpus: () => [] },
    worker_threads: { isMainThread: true, parentPort: null, workerData: null },
  };
  const defs = {}, cache = {};
  function load(name) {
    if (cache[name]) return cache[name].exports;
    if (!defs[name]) throw new Error('randle-core: ' + name + ' 모듈이 번들에 없습니다');
    const module = (cache[name] = { exports: {} });
    defs[name](module, module.exports, req, 'lib', 'lib/' + name + '.js');
    return module.exports;
  }
  function req(spec) {
    if (stubs[spec]) return stubs[spec];
    return load(spec.replace(/^\.\/(lib\/)?/, '').replace(/\.js$/, ''));
  }
defs["meta"] = function (module, exports, require, __dirname, __filename) {
'use strict';
// 게임 데이터(randle_data.json) 로드 → id로 인덱싱한 배열들.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'randle_data.json');

const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const PREFIXES = ['기본', '단판', '강심장', '승부사', '연쇄', '재현', '동형', '회귀', '여명', '태초', '절정', '극한', '스페셜'];
// 내장 데이터의 접두사 이름 → 현재 게임 화면의 이름
const DISPLAY_PREFIX = { 기본: '일반', 절정: '황혼' };

// mijeong: 'separate' = 계열이 '미정'인 업적은 각자 따로 합산(기본값), 'group' = '미정'끼리 한 계열로 보고 최고점만 합산
function loadConfig() {
  try { return { mijeong: 'separate', ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; } catch { return { mijeong: 'separate' }; }
}
function saveConfig(cfg) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 1));
}
const PX = Object.fromEntries(PREFIXES.map((p, i) => [p, i]));
const MAX_ID = 512;
// 날짜에 따라 조건이 바뀌는 업적: 기본 점수표에서 빼고 매번 계산한다.
const DATE_IDS = [65, 66, 67, 68, 326];

function loadMeta(file = DATA_FILE) {
  return buildMeta(JSON.parse(fs.readFileSync(file, 'utf8')), loadConfig());
}

// 파일 없이 데이터 객체로부터 (브라우저용)
function buildMeta(raw, config = { mijeong: 'separate' }) {
  const defs = new Array(MAX_ID).fill(null);
  const live = [];
  for (const d of raw.definitions) {
    if (d.retired) continue;
    defs[d.id] = d;
    live.push(d.id);
  }

  const sc = PREFIXES.map(p => {
    const a = new Float64Array(MAX_ID).fill(NaN);
    for (const [id, s] of Object.entries(raw.scores[p] || {})) a[+id] = Number(s);
    return a;
  });

  // 계열: 같은 계열에서는 가장 높은 RP 하나만 합산. '미정'은 설정에 따라 각자/한 묶음.
  const famIndex = new Int32Array(MAX_ID).fill(-1);
  const families = [];
  const famName = [];
  const keyToIdx = new Map();
  for (const id of live) {
    const f = defs[id].family;
    const key = !f || (f === '미정' && config.mijeong !== 'group') ? `#${id}` : f;
    let fi = keyToIdx.get(key);
    if (fi === undefined) {
      fi = families.length;
      keyToIdx.set(key, fi);
      families.push([]);
      famName.push(key);
    }
    families[fi].push(id);
    famIndex[id] = fi;
  }

  const nanArr = () => new Float64Array(MAX_ID).fill(NaN);
  const mn = nanArr(), mx = nanArr(), lo = nanArr(), up = nanArr();
  for (const id of live) {
    if (raw.minima[id] != null) mn[id] = raw.minima[id];
    if (raw.maxima[id] != null) mx[id] = raw.maxima[id];
    const b = raw.boundaries[id];
    if (b) { lo[id] = b.lower; up[id] = b.upper; }
  }

  const isHistory = new Uint8Array(MAX_ID);
  const isDate = new Uint8Array(MAX_ID);
  for (const id of live) if (defs[id].history) isHistory[id] = 1;
  for (const id of DATE_IDS) if (defs[id]) isDate[id] = 1;

  // 최신 데이터에서 합친 업적: 점수가 추정치(tools/merge-live.js)
  const estimated = new Set((raw.estimated && raw.estimated.ids) || []);
  return { raw, defs, live, sc, famIndex, families, famName, mn, mx, lo, up, isHistory, isDate, estimated, date: raw.date, config };
}

const displayPrefix = p => DISPLAY_PREFIX[p] || p;

module.exports = { loadMeta, buildMeta, loadConfig, saveConfig, displayPrefix, PREFIXES, PX, MAX_ID, DATE_IDS, ROOT, DATA_DIR, DATA_FILE };

};
defs["tables"] = function (module, exports, require, __dirname, __filename) {
'use strict';
// 1억 개 숫자 전체에 대한 조회 테이블. 빌드 때 한 번 만들어 data/tables 에 저장하고,
// 워커들과는 SharedArrayBuffer로 공유한다.
const fs = require('fs');
const path = require('path');

const N = 1e8;
const BYTES = N >> 3;

const getBit = (b, v) => (b[v >> 3] >> (v & 7)) & 1;
const setBit = (b, v) => { b[v >> 3] |= 1 << (v & 7); };

function digitLen(x) {
  let n = 1;
  while (x >= 10) { x = Math.floor(x / 10); n++; }
  return n;
}
const P10 = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16];
const cat = (x, y) => x * P10[digitLen(y)] + y;

function buildNumberTheory() {
  const comp = new Uint8Array(N);
  comp[0] = comp[1] = 1;
  for (let i = 2; i * i < N; i++) if (!comp[i]) for (let j = i * i; j < N; j += i) comp[j] = 1;

  const prime = new Uint8Array(BYTES);
  for (let v = 2; v < N; v++) if (!comp[v]) setBit(prime, v);

  // 서로 다른 소인수 개수. 4개 이상인 수의 소인수는 모두 N/30 이하이므로 그 범위의 소수만 세면
  // ω≥4 판정은 정확하다(그보다 큰 소인수가 있으면 ω≤3).
  const om = new Uint8Array(N);
  const lim = Math.floor(N / 30);
  for (let p = 2; p <= lim; p++) if (!comp[p]) for (let m = p; m < N; m += p) om[m]++;
  const omega = new Uint8Array(N >> 1);
  for (let v = 0; v < N; v += 2) omega[v >> 1] = Math.min(om[v], 15) | (Math.min(om[v + 1], 15) << 4);

  const sq = new Uint8Array(N);
  for (let p = 2; p * p < N; p++) if (!comp[p]) for (let m = p * p; m < N; m += p * p) sq[m] = 1;
  const squareful = new Uint8Array(BYTES);
  for (let v = 0; v < N; v++) if (sq[v]) setBit(squareful, v);

  return { prime, omega, squareful };
}

// #332 과잉수, #334 괴짜수(과잉수이면서 진약수 일부의 합으로 자신을 못 만듦), #335 소수 기반 암호(모든 소인수 ≥101, 2종 이상).
// 가장 작은 소인수 표(16비트: 1억 미만에서 65536 이상이 될 수 있는 건 소수 자신뿐이라 0으로 둔다)로 약수 합을 곱셈적으로 구한다.
function buildDivisorTables() {
  const spf = new Uint16Array(N);
  for (let i = 2; i < 65536; i++) if (spf[i] === 0) for (let j = i; j < N; j += i) if (spf[j] === 0) spf[j] = i;
  const sigma = new Uint32Array(N);
  sigma[1] = 1;
  const abundant = new Uint8Array(BYTES), crypt = new Uint8Array(BYTES);
  for (let n = 2; n < N; n++) {
    const p = spf[n] || n;
    let x = n, pk = 1, sp = 1;
    while (x % p === 0) { x /= p; pk *= p; sp += pk; }
    sigma[n] = sigma[x] * sp;
    if (sigma[n] > 2 * n) setBit(abundant, n);
    if (p >= 101 && x > 1) setBit(crypt, n); // 가장 작은 소인수가 101 이상이고 다른 소인수도 있음
  }
  // 반완전수: 진약수 일부의 합이 자신. 반완전수의 배수도 반완전수이므로 배수는 표시만 하고, 나머지 과잉수만 부분합을 찾는다.
  const semi = new Uint8Array(N);
  for (let n = 2; n < N; n++) if (sigma[n] === 2 * n) for (let m = n; m < N; m += n) semi[m] = 1;
  const weird = new Uint8Array(BYTES);
  const divs = new Float64Array(4096), suf = new Float64Array(4097);
  let k = 0;
  const dfs = (i, rem) => {
    if (rem === 0) return true;
    if (i === k || suf[i] < rem) return false;
    if (divs[i] <= rem && dfs(i + 1, rem - divs[i])) return true;
    return dfs(i + 1, rem);
  };
  for (let n = 2; n < N; n++) {
    if (semi[n] || !getBit(abundant, n)) continue;
    let x = n;
    divs[0] = 1;
    k = 1;
    while (x > 1) {
      const p = spf[x] || x, base = k;
      let pw = 1;
      while (x % p === 0) { x /= p; pw *= p; for (let b = 0; b < base; b++) divs[k++] = divs[b] * pw; }
    }
    const arr = Array.from(divs.subarray(0, k)).filter(d => d !== n).sort((a, b) => b - a);
    k = arr.length;
    for (let i = 0; i < k; i++) divs[i] = arr[i];
    suf[k] = 0;
    for (let i = k - 1; i >= 0; i--) suf[i] = suf[i + 1] + divs[i];
    if (dfs(0, n)) for (let m = n; m < N; m += n) semi[m] = 1;
    else setBit(weird, n);
  }
  return { abundant, weird, crypt };
}

// #231 오름차순 정렬 / #232 내림차순 정렬: 4개 이상의 엄격 증가(감소) 분할이 가능한 수.
// 판정 문자열을 앞에서부터 한 자리씩 늘려 가며 "c개로 나눴을 때 마지막 조각의 최솟값(최댓값)"을 DP로 갱신한다.
function buildSortBits() {
  const asc = new Uint8Array(BYTES), desc = new Uint8Array(BYTES);
  const dig = new Int32Array(9);
  const A = new Float64Array(9 * 5), D = new Float64Array(9 * 5);
  function visit(i, val) {
    const b = i * 5;
    for (let c = 1; c <= 4; c++) { A[b + c] = Infinity; D[b + c] = -Infinity; }
    let part = 0, p10 = 1;
    for (let j = i - 1; j >= 0; j--) {
      part += dig[j] * p10;
      p10 *= 10;
      if (i - j > 1 && dig[j] === 0) continue;
      if (j === 0) {
        if (part < A[b + 1]) A[b + 1] = part;
        if (part > D[b + 1]) D[b + 1] = part;
        continue;
      }
      const jb = j * 5;
      for (let c = 1; c <= 4; c++) {
        const nc = b + (c === 4 ? 4 : c + 1);
        if (A[jb + c] < part && part < A[nc]) A[nc] = part;
        if (D[jb + c] > part && part > D[nc]) D[nc] = part;
      }
    }
    if (A[b + 4] !== Infinity) setBit(asc, val);
    if (D[b + 4] !== -Infinity) setBit(desc, val);
    if (i < 8) for (let d = 0; d <= 9; d++) { dig[i] = d; visit(i + 1, val * 10 + d); }
  }
  for (let d = 1; d <= 9; d++) { dig[0] = d; visit(1, d); }
  return { asc, desc };
}

// 값 목록으로 판정하는 업적들(id → 값 집합).
function buildSpecialSets(raw) {
  const S = new Map();
  const add = (id, v) => {
    if (!(v >= 0 && v < N) || !Number.isInteger(v)) return;
    let s = S.get(id);
    if (!s) S.set(id, (s = new Set()));
    s.add(v);
  };
  const exact = {
    37: [1557], 61: [1], 62: [2], 63: [99999999], 64: [0], 87: [3], 88: [4], 89: [5], 90: [6], 91: [7], 92: [8], 93: [9],
    71: [69696969], 72: [67676767], 148: [18308, 180308, 1798308, 17977308], 212: [2020, 2021, 2022, 2023, 2024, 2025, 2026],
    214: [1213007], 218: [88224646], 219: [20011206], 223: [19721121], 236: [573], 237: [436879], 295: [39800], 305: [727],
    312: [1948, 1949], 422: [39393939], 280: [3, 7, 31, 127, 8191, 131071, 524287],
  };
  for (const [id, vs] of Object.entries(exact)) for (const v of vs) add(+id, v);

  const powers = { 38: 2, 39: 3, 108: 4, 109: 5, 110: 6, 111: 7, 112: 8, 113: 9, 114: 10 };
  for (const [id, k] of Object.entries(powers)) for (let n = 0; n ** k < N; n++) add(+id, n ** k);
  for (let x = 1; x < N; x *= 2) add(40, x);
  for (let x = 1; x < N; x *= 3) add(41, x);
  const prefixConsts = { 42: '31415926', 202: '27182818', 203: '16180339', 204: '14142135', 228: '17320508', 229: '22360679', 230: '26457513' };
  for (const [id, s] of Object.entries(prefixConsts)) for (let k = 1; k <= 8; k++) add(+id, +s.slice(0, k));
  for (let a = 0, b = 1; a < N; [a, b] = [b, a + b]) add(58, a);
  for (let n = 1, f = 1; f < N; n++, f *= n) add(59, f);
  for (let n = 0; (n * (n + 1)) / 2 < N; n++) add(60, (n * (n + 1)) / 2);
  for (let n = 1; n ** n < N; n++) add(120, n ** n);
  for (let n = 0, c = 1; c < N; c = (c * 2 * (2 * n + 1)) / (n + 2), n++) add(238, c);
  {
    // 벨 삼각형
    let row = [1];
    add(239, 1);
    while (row[row.length - 1] < N) {
      const next = [row[row.length - 1]];
      for (const x of row) next.push(next[next.length - 1] + x);
      row = next;
      add(239, row[0]);
    }
  }
  for (const v of raw.recaman || []) add(118, v);

  // #115 수학 시간: 순서를 유지한 채 연산자 1개와 등호 1개를 넣은 참인 식.
  // a+b=c, c=a+b, a−b=c, c=a−b, a×b=c, c=a×b, a÷b=c, c=a÷b 는 양의 정수 p,q에 대해
  // p|q|p+q, p+q|p|q, q|p+q|p, p|q|pq, pq|p|q, q|pq|p 여섯 모양으로 정리된다.
  for (let p = 1; p < 1000; p++) {
    const lp = digitLen(p);
    for (let q = 1; q < 1000; q++) {
      const lq = digitLen(q), s = p + q, m = p * q, ls = digitLen(s), lm = digitLen(m);
      if (lp + lq + ls <= 8) { add(115, cat(cat(p, q), s)); add(115, cat(cat(s, p), q)); add(115, cat(cat(q, s), p)); }
      if (lp + lq + lm <= 8) { add(115, cat(cat(p, q), m)); add(115, cat(cat(m, p), q)); add(115, cat(cat(q, m), p)); }
    }
  }

  // #116 등차수열 / #117 등비수열: 처음 두 항을 고르면 나머지가 정해진다.
  for (let a = 1; a < 1e6; a++) {
    const la = digitLen(a);
    for (let lb = 1; la + lb <= 7; lb++) for (let b = P10[lb - 1]; b < P10[lb]; b++) {
      const ab = a * P10[lb] + b;
      const used = la + lb;
      const d = b - a;
      let str = ab, len = used, t = b + d;
      while (t >= 1) {
        const lt = digitLen(t);
        if (len + lt > 8) break;
        str = str * P10[lt] + t;
        len += lt;
        add(116, str);
        t += d;
      }
      if ((b * b) % a === 0) {
        str = ab; len = used; let prev = b;
        while (true) {
          const num = prev * b;
          if (num % a !== 0) break;
          const nx = num / a, lt = digitLen(nx);
          if (len + lt > 8) break;
          str = str * P10[lt] + nx;
          len += lt;
          add(117, str);
          prev = nx;
        }
      }
    }
  }

  // #119 콜라츠 추측
  for (let a = 1; a < 1e6; a++) {
    let str = a, len = digitLen(a), t = a, n = 1;
    while (true) {
      t = t % 2 === 0 ? t / 2 : 3 * t + 1;
      const lt = digitLen(t);
      if (len + lt > 8) break;
      str = str * P10[lt] + t;
      len += lt;
      if (++n >= 3) add(119, str);
    }
  }

  // #226 a²+b²=c² (세 수의 나열 순서 무관)
  for (let a = 1; a < 1000; a++) for (let b = a + 1; b < 1000; b++) {
    const c = Math.round(Math.sqrt(a * a + b * b));
    if (c * c !== a * a + b * b) continue;
    if (digitLen(a) + digitLen(b) + digitLen(c) > 8) continue;
    for (const [x, y, z] of [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]]) add(226, cat(cat(x, y), z));
  }

  // #417 부모는 자식의 거울: 두 부분이 한 수와 그 제곱
  for (let x = 1; x < 1e4; x++) {
    const y = x * x;
    if (digitLen(x) + digitLen(y) > 8) continue;
    add(417, cat(x, y));
    add(417, cat(y, x));
  }

  // #147 Credits EXPERT: 기준 숫자열의 연속 부분 문자열(3자리 이상)
  const credits = String(raw.credits || '');
  for (let i = 0; i < credits.length; i++) {
    if (credits[i] === '0') continue;
    for (let len = 3; len <= 8 && i + len <= credits.length; len++) add(147, +credits.slice(i, i + len));
  }
  return S;
}

function packSpecial(sets) {
  const entries = [];
  for (const [id, set] of sets) for (const v of set) entries.push(v * 512 + id);
  entries.sort((a, b) => a - b);
  const values = [], offs = [0], ids = [];
  for (const e of entries) {
    const v = Math.floor(e / 512), id = e % 512;
    if (values.length && values[values.length - 1] === v) offs[offs.length - 1]++;
    else { values.push(v); offs.push(offs[offs.length - 1] + 1); }
    ids.push(id);
  }
  const bits = new Uint8Array(BYTES);
  for (const v of values) setBit(bits, v);
  return { specBits: bits, specValues: Int32Array.from(values), specOffs: Int32Array.from(offs), specIds: Int16Array.from(ids) };
}

const TABLE_TYPES = {
  prime: Uint8Array, omega: Uint8Array, squareful: Uint8Array, asc: Uint8Array, desc: Uint8Array,
  specBits: Uint8Array, specValues: Int32Array, specOffs: Int32Array, specIds: Int16Array,
  abundant: Uint8Array, weird: Uint8Array, crypt: Uint8Array,
};

function buildTables(raw, log = () => {}) {
  let t = Date.now();
  const nt = buildNumberTheory();
  log(`  소수·소인수·제곱인수 테이블 ${((Date.now() - t) / 1000).toFixed(1)}초`);
  t = Date.now();
  const div = buildDivisorTables();
  log(`  과잉수·괴짜수·소수 기반 암호 테이블 ${((Date.now() - t) / 1000).toFixed(1)}초`);
  t = Date.now();
  const sort = buildSortBits();
  log(`  오름/내림차순 분할 테이블 ${((Date.now() - t) / 1000).toFixed(1)}초`);
  t = Date.now();
  const spec = packSpecial(buildSpecialSets(raw));
  log(`  특수 수 집합 ${spec.specValues.length.toLocaleString()}개 ${((Date.now() - t) / 1000).toFixed(1)}초`);
  return { ...nt, ...div, ...sort, ...spec };
}

function saveTables(dir, tables) {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of Object.keys(TABLE_TYPES)) {
    const a = tables[name];
    fs.writeFileSync(path.join(dir, name + '.bin'), Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  }
}

// 파일에서 읽어 SharedArrayBuffer에 올린다. 반환값은 워커로 그대로 넘길 수 있다.
function loadSharedTables(dir) {
  const shared = {};
  for (const name of Object.keys(TABLE_TYPES)) {
    const file = path.join(dir, name + '.bin');
    const size = fs.statSync(file).size;
    const sab = new SharedArrayBuffer(size);
    const fd = fs.openSync(file, 'r');
    const view = new Uint8Array(sab);
    for (let off = 0; off < size; ) off += fs.readSync(fd, view, off, Math.min(1 << 28, size - off), off);
    fs.closeSync(fd);
    shared[name] = sab;
  }
  return shared;
}

function tablesFromShared(shared) {
  const t = {};
  for (const [name, T] of Object.entries(TABLE_TYPES)) t[name] = new T(shared[name]);
  return t;
}

function tablesExist(dir) {
  return Object.keys(TABLE_TYPES).every(n => fs.existsSync(path.join(dir, n + '.bin')));
}

module.exports = { N, getBit, setBit, buildTables, saveTables, loadSharedTables, tablesFromShared, tablesExist, digitLen };

};
defs["rules"] = function (module, exports, require, __dirname, __filename) {
'use strict';
// 업적 판정. 그룹 하나가 여러 업적을 한 번에 판정해 mk[id]에 "성립 자리" 마스크를 쓴다.
//   bit j = 원본 8칸의 j번째 칸(0 = 맨 왼쪽), 0 = 미달성.
// 성립 자리의 숫자열이 승부사(같은 성립 숫자)·회귀/재현/동형(직전 판과 숫자·자리 비교)의 기준이 된다.
// 각 그룹은 호출될 때마다 담당 id를 모두 써야 한다(이전 숫자의 값이 남지 않도록).
const { getBit } = require('./tables');

function makeCtx() {
  return {
    r: new Int32Array(8), v: 0, st: 0, L: 0, SIG: 0, sum: 0, maxD: 0, distinct: 0,
    cnt: new Int32Array(10), pm: new Int32Array(10),
  };
}

// r(원본 8칸)으로부터 공통 특징을 계산한다. 판정 문자열 = 앞자리 0을 뗀 부분(st..7).
function features(c) {
  const r = c.r, cnt = c.cnt, pm = c.pm;
  let st = 0;
  while (st < 7 && r[st] === 0) st++;
  c.st = st;
  c.L = 8 - st;
  c.SIG = (0xff << st) & 0xff;
  for (let d = 0; d < 10; d++) { cnt[d] = 0; pm[d] = 0; }
  let sum = 0, mx = 0, seen = 0;
  for (let i = st; i < 8; i++) {
    const d = r[i];
    cnt[d]++;
    pm[d] |= 1 << i;
    sum += d;
    if (d > mx) mx = d;
    seen |= 1 << d;
  }
  let k = 0;
  while (seen) { seen &= seen - 1; k++; }
  c.sum = sum;
  c.maxD = mx;
  c.distinct = k;
}

function setValue(c, v) {
  for (let i = 7, x = v; i >= 0; i--, x = Math.floor(x / 10)) c.r[i] = x % 10;
  c.v = v;
  features(c);
}

const strip = s => s.replace(/\s+/g, '');
const digitsOf = s => Int32Array.from(strip(s), ch => ch.charCodeAt(0) - 48);

// ---------- 부분 문자열 업적 (Aho–Corasick) ----------
const CONTAINS = [
  [36, '1557'], [69, '69'], [70, '67'], [168, '365'], [169, '666'], [170, '777'], [171, '404'], [172, '418'], [173, '112'],
  [174, '007'], [176, '1206'], [178, '314'], [179, '3141'], [180, '31415'], [181, '314159'], [182, '3141592'], [183, '31415926'],
  [184, '271'], [185, '2718'], [186, '27182'], [187, '271828'], [188, '2718281'], [189, '27182818'],
  [190, '161'], [191, '1618'], [192, '16180'], [193, '161803'], [194, '1618033'], [195, '16180339'],
  [196, '141'], [197, '1414'], [198, '14142'], [199, '141421'], [200, '1414213'], [201, '14142135'],
  [205, '1116'], [206, '411892'], [207, '7124'], [208, '16383'], [209, '4010'], [210, '1962'], [211, '39'],
  [213, '142857'], [213, '285714'], [213, '428571'], [213, '571428'], [213, '714285'], [213, '857142'],
  [235, '573'], [283, '3939'], [293, '119'], [294, '39800'], [301, '6767'], [303, '815'], [304, '727'],
  [306, '024680'], [306, '086420'], [307, '02468'], [307, '24680'], [307, '86420'], [307, '08642'],
  [308, '0246'], [308, '2468'], [308, '4680'], [308, '6420'], [308, '8642'], [308, '0864'],
  [309, '1357'], [309, '3579'], [309, '7531'], [309, '9753'], [310, '13579'], [310, '97531'],
  [414, '1336'], [421, '393939'],
  [337, '173'], [338, '1732'], [343, '223'], [344, '2236'], [349, '264'], [350, '2645'], [351, '26457'],
  // #355 마인크래프트: Java Edition 정식 릴리즈 버전(점 제거)을 포함. 1.x는 대부분 10·11·15·18·19·12x로 덮이므로 최소 패턴만 둔다.
  // 서버의 고정 목록은 성립 개수로 정확히 특정되지 않아 1.0~1.21.x와 26.1~26.3으로 근사(성립 개수 약 1% 부족).
  [355, '10'], [355, '11'], [355, '121'], [355, '122'], [355, '123'], [355, '124'], [355, '125'], [355, '131'], [355, '132'], [355, '142'], [355, '144'], [355, '145'], [355, '146'], [355, '147'], [355, '15'], [355, '151'], [355, '152'], [355, '161'], [355, '162'], [355, '164'], [355, '172'], [355, '174'], [355, '175'], [355, '176'], [355, '177'], [355, '178'], [355, '179'], [355, '1710'], [355, '18'], [355, '19'], [355, '120'], [355, '121'], [355, '1211'], [355, '261'], [355, '262'], [355, '263'],
  [500, '24'], [501, '7'], // #177 Lo-Fi Music 보조
];

function buildAC(patterns) {
  const go = [new Int32Array(10).fill(-1)], fail = [0], out = [[]];
  patterns.forEach(([tag, s]) => {
    let u = 0;
    for (const ch of s) {
      const d = ch.charCodeAt(0) - 48;
      if (go[u][d] < 0) { go[u][d] = go.length; go.push(new Int32Array(10).fill(-1)); fail.push(0); out.push([]); }
      u = go[u][d];
    }
    out[u].push([tag, s.length]);
  });
  const q = [];
  for (let d = 0; d < 10; d++) {
    const s = go[0][d];
    if (s < 0) go[0][d] = 0;
    else { fail[s] = 0; q.push(s); }
  }
  for (let h = 0; h < q.length; h++) {
    const u = q[h];
    out[u] = out[u].concat(out[fail[u]]);
    for (let d = 0; d < 10; d++) {
      const s = go[u][d];
      if (s < 0) go[u][d] = go[fail[u]][d];
      else { fail[s] = go[fail[u]][d]; q.push(s); }
    }
  }
  const n = go.length, G = new Int32Array(n * 10), os = new Int32Array(n + 1), tags = [], lens = [];
  for (let u = 0; u < n; u++) {
    for (let d = 0; d < 10; d++) G[u * 10 + d] = go[u][d];
    os[u] = tags.length;
    for (const [t, l] of out[u]) { tags.push(t); lens.push(l); }
  }
  os[n] = tags.length;
  return { G, os, tags: Int32Array.from(tags), lens: Int32Array.from(lens) };
}

// 성립 자리가 숫자 전체가 아닐 수 있는 업적(승부사 확률 계산용으로 성립 숫자열 분포를 모은다)
const WINDOW_IDS = [1, 2, 3, 5, 45, 46, 47, 48, 4, 285, 11, 56, 302, 6, 7, 8, 9, ...Array.from({ length: 9 }, (_, i) => 27 + i),
  ...Array.from({ length: 10 }, (_, i) => 121 + i), 153, 296, 297, 298, 299, 150, ...Array.from({ length: 14 }, (_, i) => 154 + i),
  ...new Set(CONTAINS.map(([t]) => t).filter(t => t < 500)), 177, 131, 133, 134, 135, 137, 139, 282,
  ...Array.from({ length: 11 }, (_, i) => 313 + i), 66, 67, 68,
  324, 325, 327, 331, 336, 337, 338, 343, 344, 349, 350, 351, 355];

const SPECIAL_IDS = [37, 61, 62, 63, 64, 87, 88, 89, 90, 91, 92, 93, 71, 72, 148, 212, 214, 218, 219, 223, 236, 237, 295, 305, 312,
  422, 280, 38, 39, 108, 109, 110, 111, 112, 113, 114, 40, 41, 42, 202, 203, 204, 228, 229, 230, 58, 59, 60, 120, 238, 239,
  118, 115, 116, 117, 119, 226, 417, 147];

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const ROT = Int32Array.from([0, 1, -1, -1, -1, -1, 9, -1, 8, 6]);
const sgn = x => (x > 0 ? 1 : x < 0 ? -1 : 0);
const B = (...ds) => ds.reduce((m, d) => m | (1 << d), 0);
const B0246 = B(0, 2, 4, 6), B2468 = B(2, 4, 6, 8), B0468 = B(0, 4, 6, 8), B1357 = B(1, 3, 5, 7), B3579 = B(3, 5, 7, 9);
const B02468 = B(0, 2, 4, 6, 8), B13579 = B(1, 3, 5, 7, 9);

// 날짜·이력과 무관한 업적 그룹들
function staticGroups(T) {
  const G = [];
  const group = (name, ids, fn) => G.push({ name, ids, fn });

  group('parity', [1, 2], (c, mk) => {
    const odd = c.r[7] & 1;
    mk[1] = odd ? 0 : 128;
    mk[2] = odd ? 128 : 0;
  });

  group('runs', [3, 5, 45, 46, 47, 48, 49, 4, 285], (c, mk) => {
    const r = c.r;
    let m2 = 0, m3 = 0, m4 = 0, m5 = 0, m6 = 0, m7 = 0, seen = 0, kinds = 0;
    for (let i = c.st; i < 8; ) {
      let j = i + 1;
      while (j < 8 && r[j] === r[i]) j++;
      const len = j - i;
      if (len >= 2) {
        const w = ((1 << len) - 1) << i;
        m2 |= w;
        if (!((seen >> r[i]) & 1)) { seen |= 1 << r[i]; kinds++; }
        if (len >= 3) m3 |= w;
        if (len >= 4) m4 |= w;
        if (len >= 5) m5 |= w;
        if (len >= 6) m6 |= w;
        if (len >= 7) m7 |= w;
      }
      i = j;
    }
    mk[3] = m2; mk[5] = m3; mk[45] = m4; mk[46] = m5; mk[47] = m6; mk[48] = m7;
    mk[49] = c.distinct === 1 ? c.SIG : 0;
    mk[4] = kinds >= 2 ? m2 : 0;
    mk[285] = kinds >= 3 ? m2 : 0;
  });

  group('fullhouse', [11, 56], (c, mk) => {
    const r = c.r;
    let m11 = 0, m56 = 0;
    for (let i = c.st; i + 5 <= 8; i++) {
      const a = r[i], b = r[i + 1], d2 = r[i + 2], d3 = r[i + 3], d4 = r[i + 4];
      if ((a === b && b === d2 && d3 === d4 && d2 !== d3) || (a === b && d2 === d3 && d3 === d4 && b !== d2)) m11 |= 31 << i;
      if (i + 6 <= 8 && a === b && b === d2 && d3 === d4 && d4 === r[i + 5] && d2 !== d3) m56 |= 63 << i;
    }
    mk[11] = m11;
    mk[56] = m56;
  });

  group('straight', [302, 6, 7, 8, 9, 10], (c, mk) => {
    const r = c.r;
    let m3 = 0, m4 = 0, m5 = 0, m6 = 0, m7 = 0, m8 = 0;
    for (let i = c.st; i < 7; ) {
      const step = r[i + 1] - r[i];
      if (step !== 1 && step !== -1) { i++; continue; }
      let j = i + 1;
      while (j < 7 && r[j + 1] - r[j] === step) j++;
      const len = j - i + 1, w = ((1 << len) - 1) << i;
      if (len >= 3) m3 |= w;
      if (len >= 4) m4 |= w;
      if (len >= 5) m5 |= w;
      if (len >= 6) m6 |= w;
      if (len >= 7) m7 |= w;
      if (len >= 8) m8 |= w;
      i = j;
    }
    mk[302] = m3; mk[6] = m4; mk[7] = m5; mk[8] = m6; mk[9] = m7; mk[10] = m8;
  });

  group('digitset', [...range(12, 21), 152, 227, 43, ...range(287, 292), 44, 225], (c, mk) => {
    const S = c.SIG, mx = c.maxD, cnt = c.cnt, L = c.L, k = c.distinct;
    mk[14] = mx <= 8 ? S : 0; mk[15] = mx <= 7 ? S : 0; mk[16] = mx <= 6 ? S : 0; mk[17] = mx <= 5 ? S : 0;
    mk[18] = mx <= 4 ? S : 0; mk[19] = mx <= 3 ? S : 0; mk[20] = mx <= 2 ? S : 0; mk[21] = mx <= 1 ? S : 0;
    const odd = cnt[1] + cnt[3] + cnt[5] + cnt[7] + cnt[9];
    mk[12] = odd === L ? S : 0;
    mk[13] = odd === 0 ? S : 0;
    mk[152] = cnt[1] + cnt[2] + cnt[3] + cnt[5] + cnt[7] === L ? S : 0;
    mk[227] = cnt[0] + cnt[1] + cnt[3] + cnt[8] === L ? S : 0;
    mk[43] = k === L ? S : 0;
    mk[287] = k === 7 ? S : 0; mk[288] = k === 6 ? S : 0; mk[289] = k === 5 ? S : 0;
    mk[290] = k === 4 ? S : 0; mk[291] = k === 3 ? S : 0; mk[292] = k === 2 ? S : 0;
    let two = L === 8 && k === 4;
    if (two) for (let d = 0; d < 10; d++) if (cnt[d] && cnt[d] !== 2) { two = false; break; }
    mk[44] = two ? S : 0;
    let named = cnt[0] === 0;
    if (named) for (let d = 1; d < 10; d++) if (cnt[d] && cnt[d] !== d) { named = false; break; }
    mk[225] = named ? S : 0;
  });

  group('mountain', [22, 73, 74, 75, 23, 76, 77, 78], (c, mk) => {
    mk[22] = mk[73] = mk[74] = mk[75] = mk[23] = mk[76] = mk[77] = mk[78] = 0;
    const r = c.r, st = c.st, L = c.L, S = c.SIG;
    if (L < 3) return;
    const first = sgn(r[st + 1] - r[st]);
    if (first === 0) return;
    let k = st + 1;
    while (k < 7 && sgn(r[k + 1] - r[k]) === first) k++;
    if (k === 7) return;
    let j = k;
    while (j < 7 && sgn(r[j + 1] - r[j]) === -first) j++;
    if (j !== 7) return;
    const p = k - st;
    const center = L & 1 ? p === (L - 1) >> 1 : p === (L >> 1) - 1 || p === L >> 1;
    let minAbs = 9, equal = true;
    const d0 = Math.abs(r[st + 1] - r[st]);
    for (let i = st; i < 7; i++) {
      const a = Math.abs(r[i + 1] - r[i]);
      if (a < minAbs) minAbs = a;
      if (a !== d0) equal = false;
    }
    const base = first > 0 ? 22 : 23, m1 = first > 0 ? 73 : 76;
    mk[base] = S;
    mk[m1] = center ? S : 0;
    mk[m1 + 1] = center && minAbs >= 2 ? S : 0;
    mk[m1 + 2] = center && minAbs >= 2 && equal ? S : 0;
  });

  group('adjacent', [24, 25, 26, 418, 53, 416, 220, 221, 222], (c, mk) => {
    const r = c.r, st = c.st, L = c.L, S = c.SIG;
    let mn = 10, mxd = 0, alt = true, add = true, sub = true, mul = true;
    for (let i = st; i < 7; i++) {
      const a = r[i + 1] - r[i], ad = a < 0 ? -a : a;
      if (ad < mn) mn = ad;
      if (ad > mxd) mxd = ad;
      if (((r[i] ^ r[i + 1]) & 1) === 0) alt = false;
    }
    for (let i = st; i + 2 < 8; i++) {
      const a = r[i], b = r[i + 1], d = r[i + 2];
      if ((a + b) % 10 !== d) add = false;
      if ((a - b + 10) % 10 !== d) sub = false;
      if ((a * b) % 10 !== d) mul = false;
    }
    const two = L >= 2, three = L >= 3;
    mk[24] = two && mn >= 2 ? S : 0;
    mk[25] = two && mn >= 3 ? S : 0;
    mk[26] = two && mn >= 6 ? S : 0;
    mk[418] = two && mn === 1 && mxd === 1 ? S : 0;
    mk[53] = two && alt ? S : 0;
    mk[416] = c.distinct <= 4 && mn >= 1 ? S : 0;
    mk[220] = three && add ? S : 0;
    mk[221] = three && sub ? S : 0;
    mk[222] = three && mul ? S : 0;
  });

  group('digitcount', [...range(27, 35), ...range(121, 130), 153], (c, mk) => {
    const cnt = c.cnt, pm = c.pm, L = c.L;
    for (let d = 1; d <= 9; d++) mk[26 + d] = cnt[d] === 1 ? pm[d] : 0;
    for (let d = 0; d <= 9; d++) mk[121 + d] = 2 * cnt[d] > L ? pm[d] : 0;
    mk[153] = cnt[0] + cnt[6] + cnt[9] + 2 * cnt[8] === 10 ? pm[0] | pm[6] | pm[8] | pm[9] : 0;
  });

  group('symmetry', [50, 51, 52, 54, 55, 296, 297, 298, 299, 300, 150], (c, mk) => {
    const r = c.r, st = c.st, L = c.L, S = c.SIG;
    let pal = true;
    for (let i = 0; i < L >> 1; i++) if (r[st + i] !== r[7 - i]) { pal = false; break; }
    mk[50] = pal ? S : 0;
    const even = L >= 2 && (L & 1) === 0, h = L >> 1;
    let half = even, nine = even, ab = even && r[st] !== r[st + 1], s1 = 0, s2 = 0;
    if (even) for (let i = 0; i < h; i++) {
      if (r[st + i] !== r[st + h + i]) half = false;
      if (r[st + i] + r[7 - i] !== 9) nine = false;
      s1 += r[st + i];
      s2 += r[st + h + i];
    }
    if (ab) for (let i = st + 2; i < 8; i++) if (r[i] !== r[i - 2]) { ab = false; break; }
    mk[51] = half ? S : 0;
    mk[52] = ab ? S : 0;
    mk[54] = even && s1 === s2 ? S : 0;
    mk[55] = nine ? S : 0;
    mk[296] = L >= 2 && r[st] === r[7] ? (1 << st) | 128 : 0;
    // 반복 업적의 성립 자리는 가장 왼쪽 구간 하나 (게임 데이터의 승부사 확률과 일치하는 해석)
    let m297 = 0, m298 = 0, m299 = 0;
    for (let i = st; i + 4 <= 8; i++) if (r[i] === r[i + 2] && r[i + 1] === r[i + 3]) { m297 = 15 << i; break; }
    for (let i = st; i + 6 <= 8; i++) {
      if (!m298 && r[i] === r[i + 3] && r[i + 1] === r[i + 4] && r[i + 2] === r[i + 5]) m298 = 63 << i;
      if (!m299 && r[i] === r[i + 2] && r[i + 2] === r[i + 4] && r[i + 1] === r[i + 3] && r[i + 3] === r[i + 5]) m299 = 63 << i;
    }
    mk[297] = m297;
    mk[298] = m298;
    mk[299] = m299;
    mk[300] = L === 8 && r[0] === r[2] && r[2] === r[4] && r[4] === r[6] && r[1] === r[3] && r[3] === r[5] && r[5] === r[7] ? 255 : 0;
    // 손거울: 가장 긴 회문 구간(같은 길이면 왼쪽)
    let m150 = 0;
    for (let len = L; len >= 4 && !m150; len--) for (let i = st; i + len <= 8; i++) {
      let ok = true;
      for (let a = i, b = i + len - 1; a < b; a++, b--) if (r[a] !== r[b]) { ok = false; break; }
      if (ok) { m150 = ((1 << len) - 1) << i; break; }
    }
    mk[150] = m150;
  });

  group('ends', range(154, 167), (c, mk) => {
    const v = c.v, m2 = v % 100, m3 = v % 1000;
    mk[154] = v % 10 === 5 ? 128 : 0;
    mk[155] = v % 10 === 0 ? 128 : 0;
    mk[156] = m2 === 25 ? 192 : 0;
    mk[157] = m2 === 50 ? 192 : 0;
    mk[158] = m2 === 75 ? 192 : 0;
    mk[159] = m2 === 0 && v >= 100 ? 192 : 0;
    mk[160] = m3 === 666 ? 224 : 0;
    mk[161] = m3 === 777 ? 224 : 0;
    mk[162] = m3 === 999 ? 224 : 0;
    mk[163] = m3 === 0 && v >= 1000 ? 224 : 0;
    mk[164] = v % 1e4 === 0 && v >= 1e4 ? 240 : 0;
    mk[165] = v % 1e5 === 0 && v >= 1e5 ? 248 : 0;
    mk[166] = v % 1e6 === 0 && v >= 1e6 ? 252 : 0;
    mk[167] = v % 1e7 === 0 && v >= 1e7 ? 254 : 0;
  });

  group('arithmetic', [...range(94, 102), ...range(79, 86), ...range(141, 146), 434, 149, 215, 216, 217], (c, mk) => {
    const v = c.v, S = c.SIG, L = c.L, sum = c.sum;
    mk[94] = v % 3 === 0 ? S : 0;
    mk[95] = v % 5 === 0 ? S : 0;
    mk[96] = v % 7 === 0 ? S : 0;
    mk[97] = v % 11 === 0 ? S : 0;
    mk[98] = v % 13 === 0 ? S : 0;
    mk[99] = v % 17 === 0 ? S : 0;
    mk[100] = v % 31 === 0 ? S : 0;
    mk[101] = v % 1009 === 0 ? S : 0;
    mk[102] = v > 0 && v % sum === 0 ? S : 0;
    for (let n = 1; n <= 8; n++) mk[87 - n] = L === n ? S : 0;
    mk[141] = v >= 970000 && v <= 979999 ? S : 0;
    mk[142] = v >= 980000 && v <= 989999 ? S : 0;
    mk[143] = v >= 990000 && v <= 994999 ? S : 0;
    mk[144] = v >= 995000 && v <= 999999 ? S : 0;
    mk[145] = v >= 1000000 && v <= 1004999 ? S : 0;
    mk[146] = v >= 1005000 && v <= 1010000 ? S : 0;
    mk[434] = v >= 10000044 && v <= 10002236 ? S : 0;
    mk[149] = sum === 21 ? S : 0;
    mk[215] = sum >= 56 ? S : 0;
    mk[216] = sum <= 24 ? S : 0;
    mk[217] = sum === 40 ? S : 0;
  });

  const { prime, omega, squareful, asc, desc, specBits, specValues, specOffs, specIds } = T;
  group('numtheory', [57, 103, 104, 105, 106, 107, 240], (c, mk) => {
    const v = c.v, S = c.SIG;
    mk[57] = getBit(prime, v) ? S : 0;
    const w = v > 0 ? (omega[v >> 1] >> ((v & 1) << 2)) & 15 : 0;
    mk[103] = w >= 4 ? S : 0;
    mk[104] = w >= 5 ? S : 0;
    mk[105] = w >= 6 ? S : 0;
    mk[106] = w >= 7 ? S : 0;
    mk[107] = w >= 8 ? S : 0;
    mk[240] = v >= 1 && !getBit(squareful, v) ? S : 0;
  });

  group('sorting', [231, 232], (c, mk) => {
    mk[231] = getBit(asc, c.v) ? c.SIG : 0;
    mk[232] = getBit(desc, c.v) ? c.SIG : 0;
  });

  {
    // 대부분의 수는 어느 집합에도 없으므로, 직전에 켠 id만 끈다.
    const dirty = new Int32Array(64);
    let nd = 0;
    group('special', SPECIAL_IDS, (c, mk) => {
      while (nd > 0) mk[dirty[--nd]] = 0;
      const v = c.v;
      if (!getBit(specBits, v)) return;
      let lo = 0, hi = specValues.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (specValues[mid] < v) lo = mid + 1;
        else hi = mid;
      }
      for (let k = specOffs[lo]; k < specOffs[lo + 1]; k++) { mk[specIds[k]] = c.SIG; dirty[nd++] = specIds[k]; }
    });
    G[G.length - 1].init = mk => { for (const id of SPECIAL_IDS) mk[id] = 0; nd = 0; };
  }

  G.push(containsGroup(CONTAINS));

  // 액자 업적의 성립 자리는 가장 왼쪽 구간 하나 (게임 데이터의 승부사 확률과 일치하는 해석)
  group('framed', range(131, 140), (c, mk) => {
    const r = c.r, st = c.st, L = c.L;
    let m131 = 0, m133 = 0, m134 = 0, m135 = 0, m137 = 0, m139 = 0;
    for (let i = st; i + 4 <= 8; i++) {
      const a = r[i], b = r[i + 1];
      if (a !== b && b === r[i + 2]) {
        let j = i + 1;
        while (j < 8 && r[j] === b) j++;
        if (j < 8 && r[j] !== a) {
          const nb = j - i - 1;
          if (nb === 2) { if (!m131) m131 = 15 << i; }
          else if (nb === 3) { if (!m133) m133 = 31 << i; }
          else if (nb === 4) { if (!m134) m134 = 63 << i; }
          else if (nb === 5) { if (!m135) m135 = 127 << i; }
        }
      }
      if (i + 6 <= 8) {
        const d3 = r[i + 3], d5 = r[i + 5];
        if (b === r[i + 2] && d3 === r[i + 4] && a !== b && a !== d3 && a !== d5 && b !== d3 && b !== d5 && d3 !== d5 && !m137) m137 = 63 << i;
        if (a === d5 && b === r[i + 4] && r[i + 2] === d3 && a !== b && a !== d3 && b !== d3 && !m139) m139 = 63 << i;
      }
    }
    mk[131] = m131; mk[133] = m133; mk[134] = m134; mk[135] = m135; mk[137] = m137; mk[139] = m139;
    const full = L === 8;
    mk[132] = full && r[1] === r[2] && r[0] !== r[1] && r[1] !== r[3] && r[0] !== r[3] &&
      r[5] === r[6] && r[4] !== r[5] && r[5] !== r[7] && r[4] !== r[7] && r[3] !== r[4] ? 255 : 0;
    let mural = full && r[0] !== r[1] && r[7] !== r[1] && r[0] !== r[7];
    if (mural) for (let i = 2; i <= 6; i++) if (r[i] !== r[1]) { mural = false; break; }
    mk[136] = mural ? 255 : 0;
    mk[138] = full && r[1] === r[2] && r[3] === r[4] && r[5] === r[6] &&
      new Set([r[0], r[1], r[3], r[5], r[7]]).size === 5 ? 255 : 0;
    mk[140] = full && r[0] === r[7] && r[1] === r[6] && r[2] === r[5] && r[3] === r[4] &&
      new Set([r[0], r[1], r[2], r[3]]).size === 4 ? 255 : 0;
  });

  group('misc', [151, 224, 233, 234, 282, 284, 311, 415, 419, 420, 431, 432, 433, 435], (c, mk) => {
    const r = c.r, st = c.st, L = c.L, S = c.SIG, cnt = c.cnt;
    // #151 저울
    let m151 = 0;
    if (L >= 3 && (c.sum & 1) === 0) {
      const half = c.sum >> 1;
      let ps = 0;
      for (let i = st; i < 7; i++) {
        ps += r[i];
        if (ps === half && (7 - i === 1 || r[i + 1] !== 0)) { m151 = S; break; }
      }
    }
    mk[151] = m151;
    // #224 이상한 팰린드롬 (180도 회전 대칭)
    let strob = true;
    for (let i = 0; i < L; i++) if (ROT[r[st + i]] !== r[7 - i]) { strob = false; break; }
    mk[224] = strob ? S : 0;
    const full = L === 8;
    mk[233] = full && r[0] === r[2] && r[2] === r[4] && r[4] === r[6] && r[1] !== r[0] && r[3] !== r[0] && r[5] !== r[0] && r[7] !== r[0] ? 255 : 0;
    mk[234] = full && r[1] === r[3] && r[3] === r[5] && r[5] === r[7] && r[0] !== r[1] && r[2] !== r[1] && r[4] !== r[1] && r[6] !== r[1] ? 255 : 0;
    // #282 구구단
    let m282 = 0;
    for (let i = st; i + 3 <= 8; i++) {
      const a = r[i], b = r[i + 1];
      if (!a || !b) continue;
      const p = a * b;
      if (p < 10) {
        if (r[i + 2] === p) m282 |= 7 << i;
        if (i + 4 <= 8 && r[i + 2] === 0 && r[i + 3] === p) m282 |= 15 << i;
      } else if (i + 4 <= 8 && r[i + 2] * 10 + r[i + 3] === p) m282 |= 15 << i;
    }
    mk[282] = m282;
    mk[284] = full && r[0] === r[1] && r[2] === r[3] && r[4] === r[5] && r[6] === r[7] && c.distinct === 4 ? 255 : 0;
    const o = r[0] * 1000 + r[2] * 100 + r[4] * 10 + r[6], e = r[1] * 1000 + r[3] * 100 + r[5] * 10 + r[7];
    mk[311] = (o === 1357 || o === 3579) && (e === 246 || e === 2468 || e === 4680) ? 255 : 0;
    // #415 회귀물
    let m415 = 0;
    if (L >= 3 && r[st] === r[7]) {
      const s0 = sgn(r[st + 1] - r[st]);
      if (s0 !== 0) {
        let k = st + 1;
        while (k < 7 && sgn(r[k + 1] - r[k]) === s0) k++;
        if (k < 7) {
          let j = k;
          while (j < 7 && sgn(r[j + 1] - r[j]) === -s0) j++;
          if (j === 7) m415 = S;
        }
      }
    }
    mk[415] = m415;
    // #419 위성 / #420 삼체
    let m419 = 0, m420 = 0;
    if (L >= 2 && (L & 1) === 0) {
      const h = L >> 1;
      let ok = true;
      for (let i = 0; i < h && ok; i++) if (ROT[r[st + i]] !== r[st + h - 1 - i]) ok = false;
      for (let i = 0; i < h && ok; i++) if (ROT[r[st + h + i]] !== r[7 - i]) ok = false;
      if (ok) { m419 = S; if (strob) m420 = S; }
    }
    mk[419] = m419;
    mk[420] = m420;
    // #431 배수(의) 진 / #435 자격심사
    let poly = true, qual = cnt[0] === 0, pref = 0;
    for (let i = st, n = 1; i < 8; i++, n++) {
      pref = pref * 10 + r[i];
      if (poly && pref % n !== 0) poly = false;
      if (qual && pref % r[i] !== 0) qual = false;
    }
    mk[431] = poly ? S : 0;
    mk[435] = qual ? S : 0;
    // #432 데칼코마니 (원본 8칸)
    const s07 = r[0] + r[7];
    mk[432] = r[1] + r[6] === s07 && r[2] + r[5] === s07 && r[3] + r[4] === s07 ? 255 : 0;
    // #433 론도
    const A2 = r[0] * 10 + r[1], B2 = r[2] * 10 + r[3], C2 = r[6] * 10 + r[7];
    mk[433] = full && r[4] === r[0] && r[5] === r[1] && r[2] !== 0 && r[6] !== 0 && A2 !== B2 && A2 !== C2 && B2 !== C2 ? 255 : 0;
  });

  group('mixed', range(313, 323), (c, mk) => {
    const r = c.r;
    let m3 = 0, m4 = 0, m5 = 0, m6 = 0, m7 = 0, m8 = 0, m319 = 0, m320 = 0, m321 = 0, m322 = 0, m323 = 0;
    for (let i = c.st; i < 8; i++) {
      let bits = 0, mn = 9, mx = 0, dup = false, zeros = 0;
      for (let j = i; j < 8; j++) {
        const d = r[j], len = j - i + 1;
        if ((bits >> d) & 1) dup = true;
        bits |= 1 << d;
        if (d < mn) mn = d;
        if (d > mx) mx = d;
        if (d === 0) zeros++;
        const w = ((1 << len) - 1) << i;
        if (!dup && len >= 3 && mx - mn === len - 1) {
          if (len === 3) m3 |= w;
          else if (len === 4) m4 |= w;
          else if (len === 5) m5 |= w;
          else if (len === 6) m6 |= w;
          else if (len === 7) m7 |= w;
          else m8 |= w;
        }
        if (len === 4 && !dup) {
          if (bits === B0246 || bits === B2468 || bits === B0468) m321 |= w;
          if (bits === B1357 || bits === B3579) m322 |= w;
        } else if (len === 5 && !dup) {
          if (bits === B02468) m320 |= w;
          if (bits === B13579) m323 |= w;
        } else if (len === 6 && bits === B02468 && zeros === 2) m319 |= w;
      }
    }
    mk[313] = m3; mk[314] = m4; mk[315] = m5; mk[316] = m6; mk[317] = m7; mk[318] = m8;
    mk[319] = m319; mk[320] = m320; mk[321] = m321; mk[322] = m322; mk[323] = m323;
  });

  // 최신 데이터(randle_live.json)에서 알게 된 업적
  const { abundant, weird, crypt } = T;
  const pv = new Float64Array(64), pmk = new Int32Array(64);
  group('newer', [324, 325, 327, 328, 330, 331, 332, 334, 335, 336], (c, mk) => {
    const r = c.r, st = c.st, L = c.L, S = c.SIG, cnt = c.cnt, v = c.v;
    // #324 거대한 수미상관: 4자리 이상, 앞 두 자리 = 뒤 두 자리
    mk[324] = L >= 4 && r[st] === r[6] && r[st + 1] === r[7] ? (3 << st) | 192 : 0;
    // #325 시상대: 가장 큰 서로 다른 숫자 셋이 한 번씩만, 서로 이웃하지 않음
    let m325 = 0;
    if (c.distinct >= 3) {
      let got = 0, ok = true;
      for (let d = 9; d >= 0 && got < 3; d--) {
        if (!cnt[d]) continue;
        if (cnt[d] !== 1) { ok = false; break; }
        m325 |= c.pm[d];
        got++;
      }
      if (!ok || (m325 & (m325 << 1)) !== 0) m325 = 0;
    }
    mk[325] = m325;
    // #327 디지털 시계: HHMMSS(00:00:00~23:59:59) 연속 6칸, 가장 왼쪽 구간
    let m327 = 0;
    for (let i = st; i + 6 <= 8; i++) {
      if (r[i] * 10 + r[i + 1] <= 23 && r[i + 2] <= 5 && r[i + 4] <= 5) { m327 = 63 << i; break; }
    }
    mk[327] = m327;
    // #328 녹일색: 2·3·4·6·8로만
    mk[328] = cnt[2] + cnt[3] + cnt[4] + cnt[6] + cnt[8] === L ? S : 0;
    // #330 끝말잇기: 둘로 나눠 앞 시작 = 뒤 끝, 앞 끝 = 뒤 시작
    let m330 = 0;
    if (L >= 2 && r[st] === r[7]) for (let i = st; i < 7; i++) if (r[i] === r[i + 1]) { m330 = S; break; }
    mk[330] = m330;
    // #331 연속된 두자리: 붙은 두 자리 수 둘(10~99)의 차이가 1, 가장 왼쪽 구간
    let m331 = 0;
    for (let i = st; i + 4 <= 8; i++) {
      if (!r[i] || !r[i + 2]) continue;
      const a = r[i] * 10 + r[i + 1], b = r[i + 2] * 10 + r[i + 3];
      if (a - b === 1 || b - a === 1) { m331 = 15 << i; break; }
    }
    mk[331] = m331;
    mk[332] = getBit(abundant, v) ? S : 0;
    mk[334] = getBit(weird, v) ? S : 0;
    mk[335] = getBit(crypt, v) ? S : 0;
    // #336 쌍둥이 소수: 겹치지 않는 두 구간이 차이 2인 소수 (앞자리 0 없는 구간만)
    let np = 0;
    for (let i = st; i < 8; i++) {
      if (r[i] === 0) continue;
      let val = 0;
      for (let j = i; j < 8; j++) {
        val = val * 10 + r[j];
        if (getBit(T.prime, val)) { pv[np] = val; pmk[np] = ((1 << (j - i + 1)) - 1) << i; np++; }
      }
    }
    let m336 = 0;
    for (let a = 0; a < np && !m336; a++) for (let b = a + 1; b < np; b++) {
      if ((pmk[a] & pmk[b]) === 0 && (pv[a] - pv[b] === 2 || pv[b] - pv[a] === 2)) { m336 = pmk[a] | pmk[b]; break; }
    }
    mk[336] = m336;
  });

  return G;
}

// 부분 문자열 업적 그룹. patterns를 일부만 넘기면 그 업적들만 판정한다(질의 때 가볍게 쓰기 위함).
function containsGroup(patterns) {
  const { G: AG, os, tags, lens } = buildAC(patterns);
  const dirty = new Int32Array(64);
  let nd = 0;
  const ids = [...new Set(patterns.map(([t]) => t).filter(t => t < 500))];
  const lofi = patterns.some(([t]) => t === 500);
  if (lofi) ids.push(177);
  const allTags = [...new Set(patterns.map(([t]) => t))];
  return {
    name: 'contains', ids,
    init: mk => { for (const t of allTags) mk[t] = 0; if (lofi) mk[177] = 0; nd = 0; },
    fn: (c, mk) => {
      while (nd > 0) mk[dirty[--nd]] = 0;
      const r = c.r;
      let s = 0;
      for (let i = c.st; i < 8; i++) {
        s = AG[s * 10 + r[i]];
        for (let k = os[s], e = os[s + 1]; k < e; k++) {
          const t = tags[k];
          if (mk[t] === 0 && nd < 64) dirty[nd++] = t;
          mk[t] |= ((1 << lens[k]) - 1) << (i - lens[k] + 1);
        }
      }
      if (lofi && mk[500] !== 0 && mk[501] !== 0) { mk[177] = mk[500] | mk[501]; dirty[nd++] = 177; }
    },
  };
}

// 오늘 날짜(한국 시간)에 따라 바뀌는 업적. ymd = 'YYYYMMDD'
const DIM = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function validYmd(v) {
  const y = Math.floor(v / 1e4), m = Math.floor(v / 100) % 100, d = v % 100;
  if (m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return d <= (m === 2 && leap ? 29 : DIM[m]);
}

function dateGroup(ymd) {
  const target = +ymd, y = +ymd.slice(0, 4), m0 = +ymd[4], m1 = +ymd[5], d0 = +ymd[6], d1 = +ymd[7];
  const y0 = +ymd[0], y1 = +ymd[1], y2 = +ymd[2], y3 = +ymd[3];
  return {
    name: 'date', ids: [65, 66, 67, 68, 326],
    fn: (c, mk) => {
      const r = c.r, st = c.st;
      mk[65] = c.v === target ? 255 : 0;
      let my = 0, mm = 0, md = 0;
      for (let i = st; i < 7; i++) {
        const a = r[i], b = r[i + 1];
        if (a === m0 && b === m1) mm |= 3 << i;
        if (a === d0 && b === d1) md |= 3 << i;
        if (i + 3 < 8 && a === y0 && b === y1 && r[i + 2] === y2 && r[i + 3] === y3) my |= 15 << i;
      }
      mk[66] = y >= 1000 ? my : 0;
      // #326 시간 여행: 8자리 전체가 유효한 YYYYMMDD이고 오늘이 아님
      mk[326] = st === 0 && c.v !== target && validYmd(c.v) ? 255 : 0;
      mk[67] = mm;
      mk[68] = md;
    },
  };
}

// 직전 판과 이어지는 [스페셜] 업적. h = { prev: Int32Array(8) 원본, prevValue, asc, desc, streaks: Int32Array(10)|null }
function historyGroup(h, defs) {
  const streakIds = [], diffIds = [];
  for (let id = 436; id <= 485; id++) if (defs[id]) streakIds.push(id);
  for (let id = 486; id <= 492; id++) if (defs[id]) diffIds.push(id);
  const pr = h.prev, pv = h.prevValue, streaks = h.streaks;
  // 이번 판에 목표 횟수에 닿을 수 있는 숫자별 연속 업적만 판정한다(나머지는 init에서 0).
  // 상수를 박아 넣은 함수로 만들어 둔다.
  const live = streakIds.filter(id => streaks && streaks[defs[id].digit] + 1 === defs[id].threshold);
  const ids = [...range(241, 254), ...range(263, 271), ...streakIds, ...diffIds];
  const a1 = h.asc + 1, d1 = h.desc + 1;
  const L = ['const r = c.r, v = c.v, S = c.SIG;', 'let sm = 0, same = 0;'];
  for (let i = 0; i < 8; i++) L.push(`if (r[${i}] === ${pr[i]}) { same++; sm |= ${1 << i}; }`);
  for (let k = 4; k <= 8; k++) L.push(`mk[${237 + k}] = same >= ${k} ? sm : 0;`);
  L.push(`if (v > ${pv}) {`);
  for (let k = 4; k <= 12; k++) L.push(`mk[${242 + k}] = ${a1 >= k ? 'S' : '0'}; mk[${259 + k}] = 0;`);
  L.push(`} else if (v < ${pv}) {`);
  for (let k = 4; k <= 12; k++) L.push(`mk[${242 + k}] = 0; mk[${259 + k}] = ${d1 >= k ? 'S' : '0'};`);
  L.push('} else {');
  for (let k = 4; k <= 12; k++) L.push(`mk[${242 + k}] = 0; mk[${259 + k}] = 0;`);
  L.push('}');
  for (const id of live) L.push(`mk[${id}] = c.cnt[${defs[id].digit}] > 0 ? c.pm[${defs[id].digit}] : 0;`);
  L.push(`const diff = v > ${pv} ? v - ${pv} : ${pv} - v;`);
  for (const id of diffIds) L.push(`mk[${id}] = diff === ${defs[id].difference} ? S : 0;`);
  return {
    name: 'history', ids,
    init: mk => { for (const id of streakIds) mk[id] = 0; },
    fn: new Function('c', 'mk', L.join('\n')),
  };
}

module.exports = { validYmd, makeCtx, features, setValue, staticGroups, dateGroup, historyGroup, containsGroup, digitsOf, SPECIAL_IDS, CONTAINS, WINDOW_IDS };

};
defs["score"] = function (module, exports, require, __dirname, __filename) {
'use strict';
// 접두사 판정과 점수. 계열마다 가장 높은 RP 하나만 합산한다.
const { PX, MAX_ID } = require('./meta');

function scoreArrays(meta) {
  const s = p => meta.sc[PX[p]];
  return {
    base: s('기본'), dan: s('단판'), gang: s('강심장'), seung: s('승부사'),
    chain: s('연쇄'), jae: s('재현'), dong: s('동형'), reg: s('회귀'),
    dawn: s('여명'), ori: s('태초'), peak: s('절정'), lim: s('극한'), spec: s('스페셜'),
    mn: Float64Array.from(meta.mn), mx: Float64Array.from(meta.mx), lo: Float64Array.from(meta.lo), up: Float64Array.from(meta.up),
  };
}

// 성립 자리의 숫자열을 하나의 정수로 (앞에 1을 붙여 길이를 구분)
function packKey(r, m) {
  let k = 1;
  for (let i = 0; i < 8; i++) if ((m >> i) & 1) k = k * 10 + r[i];
  return k;
}

// 순위 접두사(태초·극한·여명·절정) + 기본. 문맥과 무관한 점수.
function baseScore(A, id, v) {
  let s = -1, rank = false, minmax = false;
  if (v === A.mn[id] && A.ori[id] === A.ori[id]) { s = A.ori[id]; rank = minmax = true; }
  if (v === A.mx[id] && A.lim[id] === A.lim[id]) { if (A.lim[id] > s) s = A.lim[id]; rank = minmax = true; }
  if (v <= A.lo[id] && v !== A.mn[id] && A.dawn[id] === A.dawn[id]) { if (A.dawn[id] > s) s = A.dawn[id]; rank = true; }
  if (v >= A.up[id] && v !== A.mx[id] && A.peak[id] === A.peak[id]) { if (A.peak[id] > s) s = A.peak[id]; rank = true; }
  // 기본은 다른 접두어가 없을 때만. 태초·극한은 일반도 함께 수집한다.
  if ((!rank || minmax) && A.base[id] > s) s = A.base[id];
  return s;
}

// 문맥 점수.
//   X.noReroll: 리롤 없이 확정(단판)
//   X.pk/X.pm: 직전 판에서 같은 업적의 성립 숫자열 키/자리 마스크 (-1 = 직전 판 미달성)
//   X.hk: 8칸 전체 리롤 전(최초) 성립 숫자열 키 (-1 = 최초 미달성), heart=true일 때만 적용
function ctxScore(A, X, id, v, m, key, heart) {
  let s = -1, other = false, minmax = false, t;
  if (v === A.mn[id] && A.ori[id] === A.ori[id]) { s = A.ori[id]; other = minmax = true; }
  if (v === A.mx[id] && A.lim[id] === A.lim[id]) { if (A.lim[id] > s) s = A.lim[id]; other = minmax = true; }
  if (v <= A.lo[id] && v !== A.mn[id] && A.dawn[id] === A.dawn[id]) { if (A.dawn[id] > s) s = A.dawn[id]; other = true; }
  if (v >= A.up[id] && v !== A.mx[id] && A.peak[id] === A.peak[id]) { if (A.peak[id] > s) s = A.peak[id]; other = true; }
  if (X.noReroll && A.dan[id] === A.dan[id]) { if (A.dan[id] > s) s = A.dan[id]; other = true; }
  if (heart && X.hk[id] >= 0) {
    t = key === X.hk[id] ? A.seung[id] : A.gang[id];
    if (t !== t) t = A.gang[id];
    if (t === t) { if (t > s) s = t; other = true; }
  }
  if (X.pk[id] >= 0) {
    const sd = key === X.pk[id], sp = m === X.pm[id];
    t = sd && sp ? A.reg[id] : sd ? A.jae[id] : sp ? A.dong[id] : A.chain[id];
    if (t !== t) t = A.chain[id];
    if (t === t) { if (t > s) s = t; other = true; }
  }
  if ((!other || minmax) && A.base[id] > s) s = A.base[id];
  return s;
}

const PREFIX_OF = ['기본', '단판', '강심장', '승부사', '연쇄', '재현', '동형', '회귀', '여명', '태초', '절정', '극한'];

// 화면 표시용: 적용되는 모든 접두사와 점수 목록(점수 내림차순)
function ctxCandidates(A, X, id, v, m, key, heart) {
  const out = [];
  const push = (p, val) => { if (val === val) out.push({ prefix: p, score: val }); };
  let other = false, minmax = false;
  if (v === A.mn[id] && A.ori[id] === A.ori[id]) { push('태초', A.ori[id]); other = minmax = true; }
  if (v === A.mx[id] && A.lim[id] === A.lim[id]) { push('극한', A.lim[id]); other = minmax = true; }
  if (v <= A.lo[id] && v !== A.mn[id] && A.dawn[id] === A.dawn[id]) { push('여명', A.dawn[id]); other = true; }
  if (v >= A.up[id] && v !== A.mx[id] && A.peak[id] === A.peak[id]) { push('절정', A.peak[id]); other = true; }
  if (X.noReroll && A.dan[id] === A.dan[id]) { push('단판', A.dan[id]); other = true; }
  if (heart && X.hk[id] >= 0) {
    const same = key === X.hk[id];
    if (same && A.seung[id] === A.seung[id]) push('승부사', A.seung[id]);
    else push('강심장', A.gang[id]);
    other = true;
  }
  if (X.pk[id] >= 0) {
    const sd = key === X.pk[id], sp = m === X.pm[id];
    let p = sd && sp ? '회귀' : sd ? '재현' : sp ? '동형' : '연쇄';
    const val = { 회귀: A.reg, 재현: A.jae, 동형: A.dong, 연쇄: A.chain }[p][id];
    if (val !== val) p = '연쇄';
    push(p, p === '연쇄' ? A.chain[id] : val);
    other = true;
  }
  if (!other || minmax) push('기본', A.base[id]);
  out.sort((a, b) => b.score - a.score);
  return out;
}

function emptyContext() {
  return { noReroll: false, pk: new Float64Array(MAX_ID).fill(-1), pm: new Int32Array(MAX_ID).fill(-1), hk: new Float64Array(MAX_ID).fill(-1) };
}

module.exports = { scoreArrays, packKey, baseScore, ctxScore, ctxCandidates, emptyContext, PREFIX_OF };

};
defs["codegen"] = function (module, exports, require, __dirname, __filename) {
'use strict';
// 질의 하나에 고정된 점수 계산(계열 목록·접두사 점수·순위 경계·직전 판 성립 숫자열)을
// 상수를 박아 넣은 전용 함수로 만든다. 일반 루프보다 몇 배 빠르다.
const lit = x => (x === x ? (Object.is(x, -0) ? '0' : String(x)) : 'NaN');
const has = x => x === x;

// 순위 구간(태초=최솟값, 여명=하위 10%, 절정=상위 10%, 극한=최댓값)별 점수 식.
// rankOnly=true면 순위 접두사가 없는 구간은 -1(기본 점수는 다른 접두사가 없을 때만 붙으므로).
function regionExpr(A, id, rankOnly) {
  const base = A.base[id], mn = A.mn[id], mx = A.mx[id], lo = A.lo[id], up = A.up[id];
  const plain = rankOnly ? -1 : base;
  const sA = has(A.ori[id]) ? Math.max(A.ori[id], base) : plain;
  const sE = has(A.lim[id]) ? Math.max(A.lim[id], base) : plain;
  const sB = has(A.dawn[id]) ? A.dawn[id] : plain;
  const sD = has(A.peak[id]) ? A.peak[id] : plain;
  const ends = has(mn) ? `v === ${lit(mn)} ? ${lit(sA)} : v === ${lit(mx)} ? ${lit(sE)} : ${lit(plain)}` : lit(plain);
  if (!has(lo)) return `(${ends})`;
  return `(v <= ${lit(lo)} ? (v === ${lit(mn)} ? ${lit(sA)} : ${lit(sB)}) : v >= ${lit(up)} ? (v === ${lit(mx)} ? ${lit(sE)} : ${lit(sD)}) : ${lit(plain)})`;
}

// 직전 판과의 관계 점수: 회귀(같은 숫자·같은 자리) > 재현(같은 숫자) / 동형(같은 자리) > 연쇄
function relExpr(A, id, pk, pm) {
  const chain = A.chain[id];
  const pick = x => (has(x) ? x : chain);
  const reg = pick(A.reg[id]), jae = pick(A.jae[id]), dong = pick(A.dong[id]);
  return { pk, pm, reg, jae, dong, chain };
}

// windowIds: 성립 자리가 숫자 일부일 수 있는 업적. 나머지는 성립 자리 = 판정 숫자 전체이므로
// 같은 자리(같은 길이)이면서 같은 숫자 = 같은 수. 숫자열 키를 만들 필요가 없다.
function compileScorer(A, meta, fams, pk, pm, windowIds, prevValue) {
  const win = new Set(windowIds);
  const L = [];
  L.push('let dh = 0, cx = 0, b = 0, any = false, m = 0, s = 0, k = 0, rk = 0, t = 0;');
  fams.forEach(f => {
    const uIds = f.filter(id => pk[id] >= 0);
    const always = f.some(id => meta.isHistory[id] || meta.isDate[id]);
    if (!uIds.length && !always) return;
    L.push('cx = 0; any = false;');
    for (const id of uIds) {
      const R = relExpr(A, id, pk[id], pm[id]);
      L.push(`m = mk[${id}]; if (m !== 0) { any = true;`);
      if (win.has(id)) {
        L.push(`  k = 1; for (let i = 0; i < 8; i++) if ((m >> i) & 1) k = k * 10 + r[i];`);
        L.push(`  t = k === ${lit(R.pk)} ? (m === ${R.pm} ? ${lit(R.reg)} : ${lit(R.jae)}) : (m === ${R.pm} ? ${lit(R.dong)} : ${lit(R.chain)});`);
      } else {
        L.push(`  t = m === ${R.pm} ? (v === ${prevValue} ? ${lit(R.reg)} : ${lit(R.dong)}) : ${lit(R.chain)};`);
      }
      L.push(`  rk = ${regionExpr(A, id, true)};`);
      // 관계 접두사가 허용되지 않으면(NaN) 기본/순위 점수로 대체
      L.push(`  s = t === t ? (t > rk ? t : rk) : ${regionExpr(A, id, false)};`);
      L.push(`  if (s > cx) cx = s; sumCtx[${id}] += s; cntCtx[${id}]++; }`);
    }
    L.push(always ? '{' : 'if (any) {');
    L.push('  b = 0;');
    for (const id of f) {
      const inF0 = !meta.isHistory[id] && !meta.isDate[id];
      const isU = pk[id] >= 0;
      if (meta.isHistory[id]) { L.push(`  if (mk[${id}] !== 0 && ${lit(A.spec[id])} > cx) cx = ${lit(A.spec[id])};`); continue; }
      if (isU && !inF0) continue;
      const parts = [];
      if (inF0) parts.push('if (s > b) b = s;');
      if (!isU) parts.push('if (s > cx) cx = s;');
      L.push(`  if (mk[${id}] !== 0) { s = ${regionExpr(A, id, false)}; ${parts.join(' ')} }`);
    }
    L.push('  dh += cx - b;');
    L.push('}');
  });
  L.push('return dh;');
  return new Function('r', 'mk', 'v', 'sumCtx', 'cntCtx', L.join('\n'));
}

module.exports = { compileScorer };

};
defs["transform"] = function (module, exports, require, __dirname, __filename) {
'use strict';
// 1억 칸 점수표 T(원본 8칸 숫자 = 인덱스)에서, 현재 숫자 I를 기준으로
// 리롤할 칸 집합(mask, bit j = j번째 칸) 256가지 각각의 평균·최댓값을 한 번에 구한다.
// 자리마다 "고정(I의 숫자)" / "0~9 평균" 두 갈래로 내려가므로 전체 비용은 약 1.25억 번 덧셈.

const BLOCK = [1e7, 1e6, 1e5, 1e4, 1e3, 100, 10, 1];

function subsetReduce(T, I, op, map = null) {
  const out = new Float64Array(256);
  const isMax = op === 'max';
  function rec(arr, off, j, mask) {
    if (j === 8) {
      out[mask] = arr === T && map ? map(arr[off]) : arr[off];
      return;
    }
    const size = BLOCK[j];
    rec(arr, off + I[j] * size, j + 1, mask);
    const buf = new Float64Array(size);
    if (isMax) buf.fill(-Infinity);
    const raw = arr === T && map;
    for (let b = 0; b < 10; b++) {
      const base = off + b * size;
      if (isMax) {
        for (let k = 0; k < size; k++) { const x = raw ? map(arr[base + k]) : arr[base + k]; if (x > buf[k]) buf[k] = x; }
      } else if (raw) {
        for (let k = 0; k < size; k++) buf[k] += map(arr[base + k]);
      } else {
        for (let k = 0; k < size; k++) buf[k] += arr[base + k];
      }
    }
    if (!isMax) for (let k = 0; k < size; k++) buf[k] *= 0.1;
    rec(buf, 0, j + 1, mask | (1 << j));
  }
  rec(T, 0, 0, 0);
  return out;
}

// 리롤 칸 집합마다 나올 수 있는 최고 점수와, 그 점수가 나오는 결과의 개수(확률 = 개수 / 10^칸 수)
function subsetMaxCount(T, I) {
  const max = new Float64Array(256), count = new Float64Array(256);
  function rec(vals, cnts, off, j, mask) {
    if (j === 8) {
      max[mask] = vals[off];
      count[mask] = cnts ? cnts[off] : 1;
      return;
    }
    const size = BLOCK[j];
    rec(vals, cnts, off + I[j] * size, j + 1, mask);
    const mv = new Float32Array(size).fill(-Infinity), mc = new Uint32Array(size);
    for (let b = 0; b < 10; b++) {
      const base = off + b * size;
      for (let k = 0; k < size; k++) {
        const x = vals[base + k], c = cnts ? cnts[base + k] : 1;
        if (x > mv[k]) { mv[k] = x; mc[k] = c; }
        else if (x === mv[k]) mc[k] += c;
      }
    }
    rec(mv, mc, 0, j + 1, mask | (1 << j));
  }
  rec(T, null, 0, 0, 0);
  return { max, count };
}

// 목표 점수 여러 개(오름차순 th)를 한 번에: 리롤 칸 집합마다 점수 ≥ th[i] 일 확률. 결과는 out[mask * L + i].
// 결과값마다 "넘긴 목표 개수"를 세어 칸별로 누적한다. 평균 대신 정수 개수를 세므로 확률이 같은지 정확히 비교할 수 있다.
function subsetLevels(T, I, th) {
  const L = th.length, out = new Float64Array(256 * L);
  const level = x => { let k = 0; while (k < L && x >= th[k]) k++; return k; };
  function rec(arr, off, j, mask, free) {
    if (j === 8) {
      const div = 10 ** free;
      if (arr === T) { const k = level(arr[off]); for (let i = 0; i < L; i++) out[mask * L + i] = i < k ? 1 : 0; }
      else for (let i = 0; i < L; i++) out[mask * L + i] = arr[off * L + i] / div;
      return;
    }
    const size = BLOCK[j];
    rec(arr, off + I[j] * size, j + 1, mask, free);
    const buf = new Uint32Array(size * L);
    for (let b = 0; b < 10; b++) {
      const base = off + b * size;
      if (arr === T) {
        for (let k = 0; k < size; k++) { const lv = level(arr[base + k]); for (let i = 0; i < lv; i++) buf[k * L + i]++; }
      } else {
        for (let k = 0, n = size * L, s = base * L; k < n; k++) buf[k] += arr[s + k];
      }
    }
    rec(buf, 0, j + 1, mask | (1 << j), free + 1);
  }
  rec(T, 0, 0, 0, 0);
  return out;
}

module.exports = { subsetReduce, subsetMaxCount, subsetLevels };

};
defs["digitdp"] = function (module, exports, require, __dirname, __filename) {
'use strict';
// "판정 문자열에 pat 포함" 업적의 성립값 순위 경계(최솟값·최댓값·하위/상위 10%)를 자릿수 DP로 계산한다.
// 날짜로 바뀌는 업적(#66~68)은 데이터에 저장된 경계가 그 데이터 날짜 기준이라 매번 다시 구한다.

function automaton(pat) {
  const p = [...pat].map(Number), m = p.length;
  const fail = new Int32Array(m + 1);
  for (let i = 1, k = 0; i < m; i++) {
    while (k && p[i] !== p[k]) k = fail[k];
    if (p[i] === p[k]) k++;
    fail[i + 1] = k;
  }
  const delta = [];
  for (let s = 0; s <= m; s++) {
    const row = new Int32Array(10);
    for (let d = 0; d < 10; d++) {
      if (s === m) { row[d] = m; continue; }
      let k = s;
      while (k && p[k] !== d) k = fail[k];
      row[d] = p[k] === d ? k + 1 : 0;
    }
    delta.push(row);
  }
  return { delta, m };
}

// [0, X] 중 판정 문자열(앞자리 0 제외, 0은 "0")이 pat을 포함하는 수의 개수
function countContains(pat, X) {
  if (X < 0) return 0;
  const { delta, m } = automaton(pat);
  const xs = String(X).padStart(8, '0').split('').map(Number);
  const memo = new Map();
  function go(pos, s, tight, started) {
    if (pos === 8) return s === m || (!started && pat === '0') ? 1 : 0;
    const key = pos * 1000 + s * 4 + (tight ? 2 : 0) + (started ? 1 : 0);
    if (memo.has(key)) return memo.get(key);
    let total = 0;
    const hi = tight ? xs[pos] : 9;
    for (let d = 0; d <= hi; d++) {
      const st2 = started || d !== 0;
      total += go(pos + 1, st2 ? delta[s][d] : 0, tight && d === hi, st2);
    }
    memo.set(key, total);
    return total;
  }
  return go(0, 0, true, false);
}

function containsBounds(pat) {
  const total = countContains(pat, 99999999);
  const kth = k => {
    let lo = 0, hi = 99999999;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (countContains(pat, mid) >= k) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
  const R = Math.floor(total / 10);
  return {
    count: total,
    min: total >= 5 ? kth(1) : NaN,
    max: total >= 5 ? kth(total) : NaN,
    lower: total >= 20 ? kth(R) : NaN,
    upper: total >= 20 ? kth(total - R + 1) : NaN,
  };
}

module.exports = { countContains, containsBounds };

};
defs["sweepplan"] = function (module, exports, require, __dirname, __filename) {
'use strict';
// 1억 개 스윕의 구간 나누기와 결과 합치기 (Node 엔진과 브라우저 엔진이 함께 쓴다)
const N = 1e8;
const CHUNKS = 96;

// 앞쪽(앞자리 0이 많은) 구간은 가벼우므로 무거운 구간부터 나눠 준다
function chunks(count = CHUNKS) {
  const out = [];
  for (let i = 0; i < count; i++) out.push([Math.round((i * N) / count), Math.round(((i + 1) * N) / count)]);
  return out.reverse();
}

function mergeBuild(results) {
  const count = new Float64Array(512), sumBase = new Float64Array(512);
  const vmin = new Float64Array(512).fill(Infinity), vmax = new Float64Array(512).fill(-Infinity);
  const keys = new Map();
  for (const r of results) {
    for (let id = 0; id < 512; id++) {
      count[id] += r.count[id];
      sumBase[id] += r.sumBase[id];
      if (r.vmin[id] < vmin[id]) vmin[id] = r.vmin[id];
      if (r.vmax[id] > vmax[id]) vmax[id] = r.vmax[id];
    }
    for (const [id, km] of r.keyMaps) {
      if (keys.get(id) === null) continue;
      if (km === null) { keys.set(id, null); continue; }
      let acc = keys.get(id);
      if (!acc) keys.set(id, (acc = new Map()));
      for (const [k, n] of km) acc.set(k, (acc.get(k) || 0) + n);
    }
  }
  return { count, vmin, vmax, sumBase, keys };
}

function mergeQuery(results) {
  const sumCtx = new Float64Array(512), cntCtx = new Float64Array(512);
  for (const r of results) for (let id = 0; id < 512; id++) { sumCtx[id] += r.sumCtx[id]; cntCtx[id] += r.cntCtx[id]; }
  return { sumCtx, cntCtx };
}

// 업적별 성립 개수·평균 기본 점수·성립 숫자열 분포(8칸 전체 리롤의 강심장/승부사 기댓값 계산용)
function statsFromBuild(meta, { count, sumBase, keys }) {
  const out = { date: meta.date, mijeong: meta.config.mijeong, count: {}, avgBase: {}, keys: {} };
  for (const id of meta.live) {
    if (meta.isHistory[id] || !count[id]) continue;
    out.count[id] = count[id];
    out.avgBase[id] = sumBase[id] / count[id];
  }
  for (const [id, km] of keys) out.keys[id] = km ? Object.fromEntries(km) : null;
  return out;
}

// 희귀 업적 찬스용: 1~maxK칸 리롤 조합을 작업 단위로 나눈다(4칸은 조합 하나가 1만 개라 하나씩)
function rareTasks(maxK = 4) {
  const byK = [];
  for (let m = 1; m < 256; m++) { let k = 0; for (let x = m; x; x &= x - 1) k++; if (k <= maxK) (byK[k] = byK[k] || []).push(m); }
  const tasks = [];
  for (let k = 1; k <= maxK; k++) {
    const per = Math.max(1, Math.floor(10000 / 10 ** k));
    for (let i = 0; i < byK[k].length; i += per) tasks.push(byK[k].slice(i, i + per));
  }
  return tasks;
}

function mergeCounts(results) {
  const counts = new Map();
  for (const r of results) for (const [k, n] of r.counts) counts.set(k, (counts.get(k) || 0) + n);
  return counts;
}

module.exports = { N, CHUNKS, chunks, mergeBuild, mergeQuery, statsFromBuild, rareTasks, mergeCounts };

};
defs["patchplan"] = function (module, exports, require, __dirname, __filename) {
'use strict';
// 직전 판 점수표를 빠르게 만들기 위한 보조 함수들.
// 점수 차이가 작은 계열은 1억 개를 다시 훑지 않고, 정확히 다시 계산해야 하는 숫자 목록만 만들어 워커에 나눠 준다.
// (Node 엔진과 브라우저 엔진이 함께 쓴다)

const W = [1e7, 1e6, 1e5, 1e4, 1e3, 100, 10, 1];
const popcount = m => { let n = 0; while (m) { m &= m - 1; n++; } return n; };

// mask 칸은 digits로 고정, 나머지 칸은 0~9 전부인 숫자들
function cube(mask, digits) {
  const free = [];
  let base = 0;
  for (let j = 0; j < 8; j++) {
    if ((mask >> j) & 1) base += digits[j] * W[j];
    else free.push(W[j]);
  }
  const n = 10 ** free.length, out = new Int32Array(n);
  for (let idx = 0; idx < n; idx++) {
    let v = base, x = idx;
    for (let i = free.length - 1; i >= 0; i--) { v += (x % 10) * free[i]; x = Math.floor(x / 10); }
    out[idx] = v;
  }
  return out;
}

// I에서 1~maxK칸을 바꾼 숫자 전부(중복 없이: 바뀐 칸은 I와 다른 숫자만)
function neighborhood(I, maxK = 4) {
  const parts = [Int32Array.of(I.reduce((v, d) => v * 10 + d, 0))];
  for (let m = 1; m < 256; m++) {
    const k = popcount(m);
    if (k > maxK) continue;
    const pos = [];
    for (let j = 0; j < 8; j++) if ((m >> j) & 1) pos.push(j);
    let base = 0;
    for (let j = 0; j < 8; j++) if (!((m >> j) & 1)) base += I[j] * W[j];
    const n = 9 ** k, out = new Int32Array(n);
    for (let idx = 0; idx < n; idx++) {
      let v = base, x = idx;
      for (const j of pos) { const d = x % 9; x = Math.floor(x / 9); v += (d < I[j] ? d : d + 1) * W[j]; }
      out[idx] = v;
    }
    parts.push(out);
  }
  return concat(parts);
}

// 정확히 다시 계산할 숫자들. pattern =
//   { mask, digits }: mask 칸은 digits로 고정(회귀, 정해진 숫자 하나 등)
//   { near }: near에서 1~4칸이 다른 숫자 전부(백투백)
//   { key, p, not }: 성립 자리가 p칸인 다른 자리(not 제외) 어디든 key 숫자열이 놓인 숫자들(재현)
function patternList(pat) {
  if (pat.near) return neighborhood(pat.near);
  if (pat.mask != null) return cube(pat.mask, pat.digits);
  const parts = [];
  for (let m = 1; m < 256; m++) {
    if (m === pat.not || popcount(m) !== pat.p) continue;
    const digits = new Int32Array(8);
    let i = 0;
    for (let j = 0; j < 8; j++) if ((m >> j) & 1) digits[j] = pat.key[i++];
    parts.push(cube(m, digits));
  }
  return concat(parts);
}

// 결정적인 무작위 표본(평균 보정용)
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
}
function sample(n, seed) {
  const out = new Int32Array(n), next = rng(seed);
  for (let i = 0; i < n; i++) out[i] = next() % 1e8;
  return out;
}

// I에서 mask 칸을 무작위로 바꾼 숫자 n개
function cubeSample(I, mask, n, seed) {
  const out = new Int32Array(n), next = rng(seed);
  let base = 0;
  for (let j = 0; j < 8; j++) if (!((mask >> j) & 1)) base += I[j] * W[j];
  for (let i = 0; i < n; i++) {
    let v = base;
    for (let j = 0; j < 8; j++) if ((mask >> j) & 1) v += (next() % 10) * W[j];
    out[i] = v;
  }
  return out;
}

function concat(lists) {
  let n = 0;
  for (const l of lists) n += l.length;
  const out = new (lists.length ? lists[0].constructor : Int32Array)(n);
  let o = 0;
  for (const l of lists) { out.set(l, o); o += l.length; }
  return out;
}

// 정렬 후 중복 제거
function unique(list) {
  const a = Int32Array.from(list).sort();
  let n = 0;
  for (let i = 0; i < a.length; i++) if (i === 0 || a[i] !== a[i - 1]) a[n++] = a[i];
  return a.subarray(0, n);
}

function split(list, parts) {
  const out = [], size = Math.ceil(list.length / parts);
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function mergePatch(results) {
  const sumCtx = new Float64Array(512), cntCtx = new Float64Array(512);
  for (const r of results) for (let id = 0; id < 512; id++) { sumCtx[id] += r.sumCtx[id]; cntCtx[id] += r.cntCtx[id]; }
  return { sumCtx, cntCtx, diffs: results[0] && results[0].diffs ? concat(results.map(r => r.diffs)) : null };
}

module.exports = { popcount, cube, neighborhood, patternList, sample, cubeSample, concat, unique, split, mergePatch };

};
defs["worker"] = function (module, exports, require, __dirname, __filename) {
'use strict';
// 1억 개 숫자 구간을 훑는 워커.
//   build: 문맥 없는 기본 점수표 F0 + 검증용 통계(성립 개수·최솟값·최댓값) + 업적별 평균 기본 점수·성립 숫자열 분포
//   query: T = F0 + (직전 판 접두사·날짜·[스페셜]로 바뀌는 점수 차이)
const { parentPort, workerData, isMainThread } = require('worker_threads');
const { loadMeta, buildMeta, MAX_ID } = require('./meta');
const { tablesFromShared } = require('./tables');
const R = require('./rules');
const S = require('./score');
const { compileScorer } = require('./codegen');

// source: 데이터 파일 경로(Node) 또는 { raw, config } (브라우저)
function createSweeper(source, sharedTables) {
const meta = typeof source === 'string' ? loadMeta(source) : buildMeta(source.raw, source.config);
const tables = tablesFromShared(sharedTables);
const statics = R.staticGroups(tables);
const A = S.scoreArrays(meta);
const c = R.makeCtx();
const mk = new Int32Array(MAX_ID);
const KEY_CAP = 300000;

// 기본 점수표에 들어가는 계열(날짜·이력 업적 제외)
const f0Fams = [];
for (const ids of meta.families) {
  const st = ids.filter(id => !meta.isHistory[id] && !meta.isDate[id]);
  if (st.length) f0Fams.push(st);
}
const inF0 = new Uint8Array(MAX_ID);
for (const f of f0Fams) for (const id of f) inF0[id] = 1;

function flatten(fams) {
  const start = new Int32Array(fams.length + 1), ids = new Int32Array(fams.reduce((n, f) => n + f.length, 0));
  fams.forEach((f, i) => { start[i + 1] = start[i] + f.length; ids.set(f, start[i]); });
  return { start, ids };
}

function startAt(v) {
  for (let i = 7, x = v; i >= 0; i--, x = Math.floor(x / 10)) c.r[i] = x % 10;
}
function step() {
  const r = c.r;
  let i = 7;
  while (r[i] === 9) { r[i] = 0; i--; }
  r[i]++;
}

function runBuild({ lo, hi, F0, validateDate }) {
  const out = new Float32Array(F0);
  const groups = statics.concat([R.dateGroup(validateDate)]);
  for (const g of groups) if (g.init) g.init(mk);
  const fns = groups.map(g => g.fn);
  const ids = Int32Array.from(groups.flatMap(g => g.ids));
  const isWin = new Uint8Array(MAX_ID);
  for (const id of R.WINDOW_IDS) isWin[id] = 1;
  const keyMaps = new Map(R.WINDOW_IDS.map(id => [id, new Map()]));
  const count = new Float64Array(MAX_ID), sumBase = new Float64Array(MAX_ID);
  const vmin = new Float64Array(MAX_ID).fill(Infinity), vmax = new Float64Array(MAX_ID).fill(-Infinity);
  const { start, ids: famIds } = flatten(f0Fams);
  const nf = f0Fams.length;
  startAt(lo);
  for (let v = lo; v < hi; v++) {
    if (v !== lo) step();
    c.v = v;
    R.features(c);
    for (let g = 0; g < fns.length; g++) fns[g](c, mk);
    let total = 0;
    for (let f = 0; f < nf; f++) {
      let best = 0;
      for (let k = start[f], e = start[f + 1]; k < e; k++) {
        const id = famIds[k];
        if (mk[id] !== 0) { const s = S.baseScore(A, id, v); if (s > best) best = s; }
      }
      total += best;
    }
    out[v] = total;
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k], m = mk[id];
      if (m === 0) continue;
      count[id]++;
      if (v < vmin[id]) vmin[id] = v;
      vmax[id] = v;
      sumBase[id] += S.baseScore(A, id, v);
      if (isWin[id] === 1) {
        const km = keyMaps.get(id);
        if (km !== null) {
          const key = S.packKey(c.r, m);
          const n = km.get(key);
          if (n !== undefined) km.set(key, n + 1);
          else if (km.size < KEY_CAP) km.set(key, 1);
          else keyMaps.set(id, null);
        }
      }
    }
  }
  return { count, vmin, vmax, sumBase, keyMaps };
}

// q: { lo, hi, F0, T, groups: [그룹 이름], containsIds: [id]|null, dynamic: {date, history}, fams: [[id..]], ctx, bounds }
function runQuery(q) {
  const F0 = new Float32Array(q.F0), T = new Float32Array(q.T);
  const evaluate = q.fams.length > 0; // 계열이 없으면 F0 복사(+ adds)만
  const { fns, score } = evaluate ? queryEvaluator(q) : { fns: [], score: null };
  const r = c.r;
  const sumCtx = new Float64Array(MAX_ID), cntCtx = new Float64Array(MAX_ID);
  // windows = [a0, b0, a1, b1, …]: 값이 [a, b) 안인 숫자를 모아 돌려준다(나중에 정확히 다시 계산할 후보). candCap개를 넘으면 그만 모은다.
  const win = q.windows || [], nw = win.length, cap = q.candCap || Infinity;
  let cand = new Int32Array(1024), nc = 0, overflow = false;
  // adds: 판정 없이 더하는 [스페셜] 점수. 직전 판보다 크면 gt, 작으면 lt, 숫자 d가 있으면 dig[d](앞자리 0 제외),
  // 직전 판과 같은 칸이 n개면 same[n](백투백)
  const ad = q.adds || null;
  const digSum = new Float64Array(1024);
  if (ad) for (let m = 0; m < 1024; m++) for (let d = 0; d < 10; d++) if ((m >> d) & 1) digSum[m] += ad.dig[d];
  const anyDig = !!ad && ad.dig.some(x => x !== 0), anySame = !!ad && !!ad.same;
  const sameHi = new Int8Array(10000), sameLo = new Int8Array(10000);
  if (anySame) {
    for (let x = 0; x < 10000; x++) {
      for (let j = 0; j < 4; j++) {
        const d = Math.floor(x / 10 ** (3 - j)) % 10;
        if (d === ad.prev[j]) sameHi[x]++;
        if (d === ad.prev[j + 4]) sameLo[x]++;
      }
    }
  }

  if (evaluate) startAt(q.lo);
  for (let v = q.lo; v < q.hi; v++) {
    let s = 0;
    if (evaluate) {
      if (v !== q.lo) step();
      c.v = v;
      R.features(c);
      for (let g = 0; g < fns.length; g++) fns[g](c, mk);
      s = score(r, mk, v, sumCtx, cntCtx);
    }
    if (ad) {
      if (v > ad.pv) s += ad.gt;
      else if (v < ad.pv) s += ad.lt;
      const h = (v / 1e4) | 0, l = v - h * 1e4;
      if (anyDig) s += digSum[h ? DIGITS_NL[h] | DIGITS_4[l] : DIGITS_NL[l]];
      if (anySame) s += ad.same[sameHi[h] + sameLo[l]];
    }
    const x = Math.fround(F0[v] + s);
    T[v] = x;
    for (let w = 0; w < nw; w += 2) {
      if (x >= win[w] && x < win[w + 1]) {
        if (nc >= cap) { overflow = true; break; }
        if (nc === cand.length) { const b = new Int32Array(nc * 2); b.set(cand); cand = b; }
        cand[nc++] = v;
        break;
      }
    }
  }
  return { sumCtx, cntCtx, cand: cand.slice(0, nc), overflow };
}

// 0~9999의 숫자 집합(비트 d = 숫자 d가 있음): 앞자리 0 제외 / 4자리로 채워 앞자리 0 포함
const DIGITS_NL = new Int32Array(10000), DIGITS_4 = new Int32Array(10000);
for (let x = 0; x < 10000; x++) {
  let m = 0;
  for (let y = x; ; y = (y / 10) | 0) { m |= 1 << (y % 10); if (y < 10) break; }
  DIGITS_NL[x] = m;
  DIGITS_4[x] = m | (x < 1000 ? 1 : 0);
}

// 질의 q(그룹·계열·직전 판 문맥)에 맞춘 판정 함수들과 점수 함수.
// 직전 판이 달성한 업적(U)이 있는 계열만 다시 계산한다. 날짜·[스페셜] 업적은 F0에 없으므로 그 계열은 항상 계산.
// q.evalKey가 같으면 만든 함수를 다시 쓴다(새로 만든 함수는 JIT 최적화 전이라 작은 작업에서 느림).
let evalCache = null;
function queryEvaluator(q) {
  if (q.evalKey && evalCache && evalCache.key === q.evalKey) {
    for (const g of evalCache.groups) if (g.init) g.init(mk);
    for (const [id, b] of Object.entries(q.bounds)) { A.mn[id] = b.min; A.mx[id] = b.max; A.lo[id] = b.lower; A.up[id] = b.upper; }
    return evalCache.ev;
  }
  const ev = buildEvaluator(q);
  if (q.evalKey) evalCache = { key: q.evalKey, ...ev };
  return ev.ev;
}
function buildEvaluator(q) {
  const byName = new Map(statics.map(g => [g.name, g]));
  const groups = q.groups.filter(n => n !== 'contains').map(n => byName.get(n));
  if (q.containsIds && q.containsIds.length) {
    const need = new Set(q.containsIds);
    groups.push(R.containsGroup(R.CONTAINS.filter(([t]) => need.has(t) || (need.has(177) && t >= 500))));
  }
  if (q.dynamic.date) groups.push(R.dateGroup(q.dynamic.date));
  if (q.dynamic.history) {
    const h = q.dynamic.history;
    groups.push(R.historyGroup({ ...h, prev: Int32Array.from(h.prev), streaks: h.streaks && Int32Array.from(h.streaks) }, meta.defs));
  }
  for (const g of groups) if (g.init) g.init(mk);
  for (const [id, b] of Object.entries(q.bounds)) { A.mn[id] = b.min; A.mx[id] = b.max; A.lo[id] = b.lower; A.up[id] = b.upper; }
  const prevValue = q.prevValue != null ? q.prevValue : q.dynamic.history ? q.dynamic.history.prevValue : -1;
  return { groups, ev: { fns: groups.map(g => g.fn), score: compileScorer(A, meta, q.fams, q.ctx.pk, q.ctx.pm, R.WINDOW_IDS, prevValue) } };
}

// 목록의 숫자만 정확히(전체 질의 q로) 다시 계산해 T에 쓴다.
//   accumulate: 업적별 문맥 점수 합을 돌려준다(무작위 표본으로 평균 문맥 점수를 잴 때)
//   probe: T에 쓰지 않고 원래 T 값과의 차이만 돌려준다(기댓값 보정용)
function runPatch(q) {
  const F0 = new Float32Array(q.F0), T = new Float32Array(q.T);
  const { fns, score } = queryEvaluator(q);
  const r = c.r, list = q.list;
  const sumCtx = new Float64Array(MAX_ID), cntCtx = new Float64Array(MAX_ID);
  const diffs = q.probe ? new Float64Array(list.length) : null;
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    startAt(v);
    c.v = v;
    R.features(c);
    for (let g = 0; g < fns.length; g++) fns[g](c, mk);
    const x = Math.fround(F0[v] + score(r, mk, v, sumCtx, cntCtx));
    if (diffs) diffs[i] = x - T[v];
    else T[v] = x;
  }
  if (!q.accumulate) { sumCtx.fill(0); cntCtx.fill(0); }
  return { sumCtx, cntCtx, diffs };
}

// T에서 값이 windows 구간 안인 숫자 찾기(목표 점수를 바꿨을 때 후보 다시 모으기)
function runScan({ lo, hi, T: buf, windows }) {
  const T = new Float32Array(buf), nw = windows.length;
  const out = [];
  for (let v = lo; v < hi; v++) {
    const x = T[v];
    for (let w = 0; w < nw; w += 2) if (x >= windows[w] && x < windows[w + 1]) { out.push(v); break; }
  }
  return { cand: Int32Array.from(out) };
}

// 새 업적 조사: 성립 개수·최솟값·최댓값, Σ0.19^(성립 자리 수)(회귀 확률 추정용), 성립 숫자열 분포(승부사 확률용)
function runProbe({ lo, hi, ids, date }) {
  const want = new Set(ids);
  const groups = statics.filter(g => g.ids.some(id => want.has(id))).concat([R.dateGroup(date)]);
  for (const g of groups) if (g.init) g.init(mk);
  const fns = groups.map(g => g.fn);
  const list = Int32Array.from(ids);
  const count = new Float64Array(MAX_ID), sum019 = new Float64Array(MAX_ID);
  const vmin = new Float64Array(MAX_ID).fill(Infinity), vmax = new Float64Array(MAX_ID).fill(-Infinity);
  // 성립 숫자열 분포는 일부 칸 성립 업적만(숫자 전체 성립이면 승부사 확률이 q×10⁻⁸로 정해짐)
  const win = new Set(R.WINDOW_IDS);
  const keyMaps = new Map(ids.map(id => [id, win.has(id) ? new Map() : null]));
  const pow019 = Float64Array.from({ length: 9 }, (_, m) => 0.19 ** m);
  startAt(lo);
  for (let v = lo; v < hi; v++) {
    if (v !== lo) step();
    c.v = v;
    R.features(c);
    for (let g = 0; g < fns.length; g++) fns[g](c, mk);
    for (let k = 0; k < list.length; k++) {
      const id = list[k], m = mk[id];
      if (m === 0) continue;
      count[id]++;
      if (v < vmin[id]) vmin[id] = v;
      vmax[id] = v;
      let bits = 0;
      for (let x = m; x; x &= x - 1) bits++;
      sum019[id] += pow019[bits];
      const km = keyMaps.get(id);
      if (km !== null) {
        const key = S.packKey(c.r, m), n = km.get(key);
        if (n !== undefined) km.set(key, n + 1);
        else if (km.size < KEY_CAP) km.set(key, 1);
        else keyMaps.set(id, null);
      }
    }
  }
  return { lo, hi, count, vmin, vmax, sum019, keyMaps };
}

// 희귀 업적 찬스: 리롤할 칸 집합(masks)마다 모든 결과를 판정해, 등급이 minTier 이상인 (접두사, 업적)을 딴 결과 수를 센다.
// 접두사 규칙은 화면용 ctxCandidates와 같다(리롤했으므로 단판 없음, 4칸 이하라 강심장/승부사 없음). 모든 접두사가 따로 수집된다.
const PIDX = Object.fromEntries(require('./meta').PREFIXES.map((p, i) => [p, i]));
function runRare(q) {
  const groups = statics.concat([R.dateGroup(q.dynamic.date)]);
  if (q.dynamic.history) {
    const h = q.dynamic.history;
    groups.push(R.historyGroup({ ...h, prev: Int32Array.from(h.prev), streaks: h.streaks && Int32Array.from(h.streaks) }, meta.defs));
  }
  for (const g of groups) if (g.init) g.init(mk);
  const fns = groups.map(g => g.fn);
  for (const [id, b] of Object.entries(q.bounds)) { A.mn[id] = b.min; A.mx[id] = b.max; A.lo[id] = b.lower; A.up[id] = b.upper; }
  const pk = Float64Array.from(q.ctx.pk), pm = Int32Array.from(q.ctx.pm);
  const tier = new Int8Array(16 * MAX_ID).fill(-1);
  for (const [p, row] of Object.entries(meta.raw.rarityByPrefix)) for (const [id, t] of Object.entries(row)) tier[PIDX[p] * MAX_ID + +id] = t;
  const ids = Int32Array.from(meta.live.filter(id => PREFIX_KEYS.some(p => tier[PIDX[p] * MAX_ID + id] >= q.minTier)));
  const I = q.I, r = c.r;
  const counts = new Map();
  const inc = (mask, p, id) => { const k = mask * 8192 + p * MAX_ID + id; counts.set(k, (counts.get(k) || 0) + 1); };
  const X = { BASE: PIDX['기본'], ORI: PIDX['태초'], LIM: PIDX['극한'], DAWN: PIDX['여명'], PEAK: PIDX['절정'], CHAIN: PIDX['연쇄'], JAE: PIDX['재현'], DONG: PIDX['동형'], REG: PIDX['회귀'], SPEC: PIDX['스페셜'] };
  const ok = (arr, id) => arr[id] === arr[id];
  for (const mask of q.masks) {
    const free = [];
    for (let j = 0; j < 8; j++) if ((mask >> j) & 1) free.push(j);
    const n = 10 ** free.length;
    for (let idx = 0; idx < n; idx++) {
      for (let j = 0; j < 8; j++) r[j] = I[j];
      for (let i = free.length - 1, x = idx; i >= 0; i--, x = Math.floor(x / 10)) r[free[i]] = x % 10;
      let v = 0;
      for (let j = 0; j < 8; j++) v = v * 10 + r[j];
      c.v = v;
      R.features(c);
      for (let g = 0; g < fns.length; g++) fns[g](c, mk);
      for (let k = 0; k < ids.length; k++) {
        const id = ids[k], m = mk[id];
        if (m === 0) continue;
        if (meta.isHistory[id]) { if (tier[X.SPEC * MAX_ID + id] >= q.minTier) inc(mask, X.SPEC, id); continue; }
        let other = false, minmax = false;
        const take = p => { if (tier[p * MAX_ID + id] >= q.minTier) inc(mask, p, id); };
        if (v === A.mn[id] && ok(A.ori, id)) { take(X.ORI); other = minmax = true; }
        if (v === A.mx[id] && ok(A.lim, id)) { take(X.LIM); other = minmax = true; }
        if (v <= A.lo[id] && v !== A.mn[id] && ok(A.dawn, id)) { take(X.DAWN); other = true; }
        if (v >= A.up[id] && v !== A.mx[id] && ok(A.peak, id)) { take(X.PEAK); other = true; }
        if (pk[id] >= 0) {
          const key = S.packKey(r, m), sd = key === pk[id], sp = m === pm[id];
          let p = sd && sp ? X.REG : sd ? X.JAE : sp ? X.DONG : X.CHAIN;
          const arr = [A.chain, A.jae, A.dong, A.reg][[X.CHAIN, X.JAE, X.DONG, X.REG].indexOf(p)];
          if (!ok(arr, id)) p = X.CHAIN;
          if (ok(A.chain, id) || p !== X.CHAIN) { take(p); other = true; }
        }
        if (!other || minmax) take(X.BASE);
      }
    }
  }
  return { counts };
}
const PREFIX_KEYS = ['기본', '연쇄', '재현', '동형', '회귀', '여명', '태초', '절정', '극한', '스페셜'];

// 검증용: 8칸 전체 리롤에서 강심장/승부사가 더하는 점수의 정확한 합 (직전 판 문맥 포함)
function runHeart(q) {
  const groups = statics.slice();
  groups.push(R.dateGroup(q.dynamic.date));
  for (const [id, b] of Object.entries(q.bounds)) { A.mn[id] = b.min; A.mx[id] = b.max; A.lo[id] = b.lower; A.up[id] = b.upper; }
  for (const g of groups) if (g.init) g.init(mk);
  const fns = groups.map(g => g.fn);
  const X = { noReroll: false, pk: Float64Array.from(q.ctx.pk), pm: Int32Array.from(q.ctx.pm), hk: Float64Array.from(q.hk) };
  const fams = meta.families.filter(f => f.some(id => X.hk[id] >= 0));
  const r = c.r;
  let sum = 0;
  startAt(q.lo);
  for (let v = q.lo; v < q.hi; v++) {
    if (v !== q.lo) step();
    c.v = v;
    R.features(c);
    for (let g = 0; g < fns.length; g++) fns[g](c, mk);
    for (const f of fams) {
      let a = 0, h = 0;
      for (const id of f) {
        const m = mk[id];
        if (m === 0 || meta.isHistory[id]) continue;
        const key = S.packKey(r, m);
        const s1 = S.ctxScore(A, X, id, v, m, key, false), s2 = S.ctxScore(A, X, id, v, m, key, true);
        if (s1 > a) a = s1;
        if (s2 > h) h = s2;
      }
      sum += h - a;
    }
  }
  return { sum };
}

return { runBuild, runQuery, runPatch, runScan, runHeart, runProbe, runRare };
}

if (!isMainThread && parentPort) {
  const sweeper = createSweeper(workerData.dataFile, workerData.tables);
  parentPort.on('message', msg => {
    try {
      const run = { build: sweeper.runBuild, heart: sweeper.runHeart, probe: sweeper.runProbe, rare: sweeper.runRare, patch: sweeper.runPatch, scan: sweeper.runScan }[msg.task] || sweeper.runQuery;
      const res = run(msg);
      parentPort.postMessage({ id: msg.id, ok: true, res });
    } catch (e) {
      parentPort.postMessage({ id: msg.id, ok: false, error: e.stack || String(e) });
    }
  });
}

module.exports = { createSweeper };

};
defs["analyze"] = function (module, exports, require, __dirname, __filename) {
'use strict';
// 한 판 분석: 지금 확정할 때 점수, 리롤할 칸 조합 255가지의 기댓값.
const { loadMeta, MAX_ID, PREFIXES } = require('./meta');
const { tablesFromShared } = require('./tables');
const R = require('./rules');
const S = require('./score');
const { containsBounds } = require('./digitdp');
const { subsetReduce, subsetMaxCount, subsetLevels } = require('./transform');
const P = require('./patchplan');

const DEFAULT_TARGETS = [1e8, 1e9, 1e10, 1e11]; // 1억·10억·100억·1000억

// 빠른 직전 판 점수표(Helper.splitQuery 참고)
const FAST_BOUND = 0.9;   // 훑지 않는 계열의 점수 차이 합 상한 = 가장 낮은 목표 점수 × 이 값
const ENUM_MAX = 1e6;     // 큰 점수(회귀·재현)가 이 개수 이하의 정해진 숫자에서만 나면 그 숫자들을 직접 계산
const ENUM_BUDGET = 3e6;  // 직접 계산할 숫자 목록 크기 합 상한(점수가 큰 것부터)
const ENUM_MIN = 1e5;     // 그보다 작은 점수는 그냥 상한에 넣는다
const SAMPLE_N = 100000;  // 업적별 평균 문맥 점수(강심장 보정용)를 재는 무작위 표본
const EV_SAMPLES = 8000;  // 5칸 이상 리롤 조합마다 기댓값 보정용 무작위 결과 수
const SE_MAX = 20000;     // 표본 보정의 오차(대략 점수 × √(성립 비율 / 표본 수))가 이보다 큰 계열은 기댓값을 위해 훑는다
const PATCH_MAX = 5e6;    // 다시 계산할 숫자가 이보다 많으면 1억 개를 모두 훑는다
const choose = (n, k) => { let x = 1; for (let i = 0; i < k; i++) x = (x * (n - i)) / (i + 1); return x; };
const windowsOf = (targets, f) => targets.flatMap(t => [t - f.B - (t * 1e-6 + 1), t - f.lo + (t * 1e-6 + 1)]);

function kstToday() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}`;
}

const parseRoll = s => {
  const d = String(s).replace(/[\s,_-]/g, '');
  if (!/^\d{1,8}$/.test(d)) return null;
  return Int32Array.from(d.padStart(8, '0'), ch => ch.charCodeAt(0) - 48);
};
const rollStr = r => Array.from(r).join('');
const rollValue = r => r.reduce((v, d) => v * 10 + d, 0);

const popcount = m => { let n = 0; while (m) { m &= m - 1; n++; } return n; };

// mask 칸을 바꾼 결과 중 점수가 target인 숫자 하나(원본 8칸)
function exampleOf(T, I, mask, target) {
  const free = [];
  let base = 0;
  for (let j = 0; j < 8; j++) {
    const w = 10 ** (7 - j);
    if ((mask >> j) & 1) free.push(w);
    else base += I[j] * w;
  }
  const n = 10 ** free.length;
  for (let idx = 0; idx < n; idx++) {
    let v = base, x = idx;
    for (let i = free.length - 1; i >= 0; i--) { v += (x % 10) * free[i]; x = Math.floor(x / 10); }
    if (T[v] === target) return Int32Array.from(String(v).padStart(8, '0'), ch => ch.charCodeAt(0) - 48);
  }
  return null;
}

// #326 시간 여행(오늘이 아닌 유효한 8자리 날짜)의 성립값 순위 경계
function travelBounds(today) {
  const vals = [];
  for (let y = 1000; y <= 9999; y++) for (let m = 1; m <= 12; m++) for (let d = 1; d <= 31; d++) {
    const v = y * 10000 + m * 100 + d;
    if (v !== today && R.validYmd(v)) vals.push(v);
  }
  const n = vals.length, k = Math.floor(n / 10);
  return { count: n, min: vals[0], max: vals[n - 1], lower: vals[k - 1], upper: vals[n - k] };
}

class Helper {
  // engine: { tables, query(q) }. meta/stats를 넘기지 않으면 data/ 파일에서 읽는다(Node).
  // fast=false면 직전 판 점수표를 항상 1억 개 전부 다시 계산한다(검증용).
  constructor(engine, { meta, stats, fast = true } = {}) {
    this.engine = engine;
    this.fast = fast;
    this.targets = DEFAULT_TARGETS;
    this.winSet = new Set(R.WINDOW_IDS);
    this.meta = meta || loadMeta();
    this.A = S.scoreArrays(this.meta);
    this.stats = stats || JSON.parse(require('fs').readFileSync(require('./engine').STATS_FILE, 'utf8'));
    this.statics = R.staticGroups(tablesFromShared(engine.tables));
    this.owner = new Map();
    for (const g of this.statics) for (const id of g.ids) this.owner.set(id, g.name);
    this.c = R.makeCtx();
    this.mk = new Int32Array(MAX_ID);
    this.boundsCache = new Map();
    this.prepared = null;
    this.preparing = Promise.resolve();
  }

  // 날짜 업적(#66~68)의 순위 경계와 성립 개수
  dateBounds(ymd) {
    if (!this.boundsCache.has(ymd)) {
      const b = { 66: containsBounds(ymd.slice(0, 4)), 67: containsBounds(ymd.slice(4, 6)), 68: containsBounds(ymd.slice(6, 8)) };
      if (this.meta.defs[326]) b[326] = travelBounds(+ymd);
      this.boundsCache.set(ymd, b);
    }
    return this.boundsCache.get(ymd);
  }

  applyBounds(bounds) {
    for (const [id, b] of Object.entries(bounds)) { this.A.mn[id] = b.min; this.A.mx[id] = b.max; this.A.lo[id] = b.lower; this.A.up[id] = b.upper; }
  }

  historyInfo(state) {
    if (!state.prev) return null;
    const prev = parseRoll(state.prev);
    return { prev: Array.from(prev), prevValue: rollValue(prev), asc: state.asc || 1, desc: state.desc || 1, streaks: state.streaks || null };
  }

  // 이번 판에 나올 수 있는 [스페셜] 업적인지(상승·하락은 이어진 횟수, 숫자별 연속은 목표 횟수에 닿는 것만)
  historyCan(h, id) {
    if (id >= 246 && id <= 254) return id - 242 <= h.asc + 1;
    if (id >= 263 && id <= 271) return id - 259 <= h.desc + 1;
    if (id >= 436 && id <= 485) { const d = this.meta.defs[id]; return !!h.streaks && h.streaks[d.digit] + 1 === d.threshold; }
    return true;
  }

  // 한 숫자의 모든 업적 판정 → mk
  evaluate(raw, ymd, hist) {
    const c = this.c, mk = this.mk;
    c.r.set(raw);
    c.v = rollValue(raw);
    R.features(c);
    for (const g of this.statics) g.fn(c, mk);
    R.dateGroup(ymd).fn(c, mk);
    if (hist) {
      const g = R.historyGroup({ ...hist, prev: Int32Array.from(hist.prev), streaks: hist.streaks && Int32Array.from(hist.streaks) }, this.meta.defs);
      g.init(mk);
      g.fn(c, mk);
    } else {
      for (const id of this.meta.live) if (this.meta.isHistory[id]) mk[id] = 0;
    }
    return mk;
  }

  // 직전 판(P)의 성립 숫자열/자리 → 연쇄·재현·동형·회귀 판정 기준
  prevContext(state, ymd) {
    const X = S.emptyContext();
    const U = [];
    if (!state.prev) return { X, U };
    const P = parseRoll(state.prev);
    const mk = this.evaluate(P, ymd, null);
    const A = this.A;
    for (const id of this.meta.live) {
      if (!mk[id] || this.meta.isHistory[id]) continue;
      if (A.chain[id] !== A.chain[id] && A.jae[id] !== A.jae[id] && A.dong[id] !== A.dong[id] && A.reg[id] !== A.reg[id]) continue;
      X.pk[id] = S.packKey(P, mk[id]);
      X.pm[id] = mk[id];
      U.push(id);
    }
    return { X, U };
  }

  stateKey(state, ymd) {
    return JSON.stringify([state.prev || null, state.asc || 1, state.desc || 1, state.streaks || null, ymd]);
  }

  // 직전 판 문맥으로 다시 계산해야 하는 계열과 그 판정 그룹
  buildQuery(state) {
    const ymd = state.date || kstToday();
    const bounds = this.dateBounds(ymd);
    this.applyBounds(bounds);
    const hist = this.historyInfo(state);
    const { X, U } = this.prevContext(state, ymd);
    const meta = this.meta;
    const famSet = new Set(U.map(id => meta.famIndex[id]));
    for (const id of meta.live) if (meta.isDate[id] || (hist && meta.isHistory[id])) famSet.add(meta.famIndex[id]);
    const fams = [...famSet].map(fi => meta.families[fi].filter(id => !meta.isHistory[id] || (hist && this.historyCan(hist, id)))).filter(f => f.length);
    const q = {
      ...this.groupsOf(fams), fams, bounds,
      dynamic: { date: ymd, history: hist },
      ctx: { pk: Array.from(X.pk), pm: Array.from(X.pm) },
      evalKey: this.stateKey(state, ymd), // 워커가 만든 판정·점수 함수를 다시 쓰는 열쇠
    };
    return { ymd, bounds, hist, X, U, q };
  }

  // 계열들을 판정하는 데 필요한 그룹
  groupsOf(fams) {
    const groups = new Set(), containsIds = [];
    for (const f of fams) for (const id of f) {
      const g = this.owner.get(id);
      if (!g) continue;
      if (g === 'contains') containsIds.push(id);
      else groups.add(g);
    }
    return { groups: [...groups], containsIds };
  }

  // 빠른 직전 판 점수표: F0에 더해지는 점수 차이를 계열마다 셋 중 하나로 처리한다.
  //  sweep: 1억 개를 모두 다시 판정한다. 점수 차이가 크면서 어느 숫자에서 생길지 미리 알 수 없는 계열(큰 동형·연쇄 등).
  //  adds: 판정 없이 바로 더한다. 상승·하락(직전 판보다 큰지/작은지), 숫자별 연속(그 숫자가 있는지).
  //  bounded: 점수 차이가 숫자마다 [lo, hi] 안인 계열. 이런 계열 hi의 합 B가 작으면, 훑은 점수가 목표 점수 바로 아래(B 이내)인
  //           숫자만 정확히 다시 계산해도 목표 점수를 넘는지는 모든 숫자에서 정확하다.
  //           큰 점수가 정해진 몇 숫자에서만 나는 경우(회귀: 직전 판과 같은 자리에 같은 숫자, 성립 자리가 많은 업적의 재현,
  //           백투백: 직전 판과 4칸 이상 같음, 날짜 업적의 태초·극한 등)는 그 숫자들을 직접 계산한다(patterns).
  splitQuery(q, X, prevRaw, hist, ymd, targets) {
    const A = this.A, meta = this.meta, cap = FAST_BOUND * Math.min(...targets);
    const sweep = [], bounded = [], fams = [];
    const rate = id => (meta.isDate[id] ? (q.bounds[id] ? q.bounds[id].count : 1) : this.stats.count[id] || 0) / 1e8; // 성립 비율
    const adds = { pv: hist ? hist.prevValue : -1, prev: prevRaw ? Array.from(prevRaw) : null, gt: 0, lt: 0, dig: new Array(10).fill(0), same: null };
    const one = v => ({ mask: 255, digits: parseRoll(String(v)) });
    const inRange = (f, a, b) => f.every(id => id >= a && id <= b);
    for (const f of q.fams) {
      if (f.some(id => meta.isHistory[id])) {
        const spec = Math.max(...f.map(id => A.spec[id]));
        if (!f.every(id => meta.isHistory[id]) || spec !== spec) sweep.push(f);
        else if (inRange(f, 246, 254)) adds.gt = spec; // 남은 업적(이어진 횟수 이하)이 직전 판보다 크면 모두 성립
        else if (inRange(f, 263, 271)) adds.lt = spec;
        else if (inRange(f, 436, 485) && f.length === 1) adds.dig[meta.defs[f[0]].digit] = spec;
        else if (inRange(f, 241, 245)) adds.same = Array.from({ length: 9 }, (_, n) => Math.max(0, ...f.filter(id => id - 237 <= n).map(id => A.spec[id]))); // 같은 칸이 id-237개 이상
        else if (inRange(f, 486, 492)) {
          const pats = [];
          for (const id of f) for (const v of [hist.prevValue + meta.defs[id].difference, hist.prevValue - meta.defs[id].difference]) if (v >= 0 && v < 1e8) pats.push(one(v));
          bounded.push({ f, hi: 0, lo: 0, pats });
        } else sweep.push(f);
        continue;
      }
      // 날짜 업적은 F0에 없으므로 점수 전체가 차이. 태초·극한(최솟값·최댓값)과 #65(오늘 날짜)는 그 숫자만 직접 계산.
      // 직전 판도 날짜 업적을 달성했으면 아래에서 관계 접두사(회귀·재현 등)도 함께 본다.
      if (f.some(id => meta.isDate[id]) && !f.every(id => meta.isDate[id])) { sweep.push(f); continue; }
      const fam = { f, top: [], lo: 0, pats: [], rels: [] };
      for (const id of f) {
        if (!meta.isDate[id]) continue;
        if (id === 65) { fam.pats.push(one(+ymd)); continue; }
        let top = 0;
        for (const x of [A.base[id], A.dawn[id], A.peak[id]]) if (x === x && x > top) top = x;
        fam.top.push([top, rate(id)]);
        for (const v of [A.mn[id], A.mx[id]]) if (v === v) fam.pats.push(one(v));
      }
      for (const id of f) {
        if (X.pk[id] < 0 || id === 65) continue; // #65는 오늘 날짜 하나뿐이라 위에서 직접 계산
        const pm = X.pm[id], p = P.popcount(pm), r = rate(id);
        const pick = x => (x === x ? x : A.chain[id]); // 관계 접두사가 없으면 연쇄
        // [점수, 그 점수가 날 수 있는 숫자 목록(없으면 null), 목록 크기, 대략적인 비율]
        if (this.winSet.has(id)) {
          fam.rels.push([pick(A.reg[id]), { mask: pm, digits: prevRaw }, 10 ** (8 - p), r * 10 ** -p]);
          if (p < 8) {
            const key = [];
            for (let j = 0; j < 8; j++) if ((pm >> j) & 1) key.push(prevRaw[j]);
            fam.rels.push([pick(A.jae[id]), { key, p, not: pm }, (choose(8, p) - 1) * 10 ** (8 - p), r]);
          }
          fam.rels.push([pick(A.dong[id]), null, 0, r]);
        } else {
          // 성립 자리 = 숫자 전체: 같은 자리·같은 숫자는 직전 판과 같은 수뿐, 재현은 없음
          fam.rels.push([pick(A.reg[id]), { mask: 255, digits: prevRaw }, 1, 0]);
          fam.rels.push([pick(A.dong[id]), null, 0, r]);
        }
        fam.rels.push([A.chain[id], null, 0, r]);
        for (const [t] of fam.rels) if (t === t && A.base[id] === A.base[id] && t - A.base[id] < fam.lo) fam.lo = t - A.base[id];
      }
      fams.push(fam);
    }
    // 직접 계산할 목록: 점수가 큰 것부터, 목록 크기 합이 ENUM_BUDGET 안에서
    const cands = fams.flatMap(x => x.rels).filter(([t, pat, size]) => t === t && pat && t > ENUM_MIN && size <= ENUM_MAX).sort((x, y) => y[0] - x[0]);
    let budget = ENUM_BUDGET;
    const enumed = new Set();
    for (const r of cands) if (r[2] <= budget) { enumed.add(r); budget -= r[2]; }
    for (const x of fams) {
      // 직접 계산하지 않는 관계는 상한(hi)에 넣는다. 표본 보정의 오차(점수 × √(비율 / 표본 수))가 크면 기댓값을 위해 훑는다.
      let hi = 0, se = 0;
      const pats = x.pats.slice();
      for (const [t, r] of x.top) { hi = Math.max(hi, t); se += t * Math.sqrt(r / EV_SAMPLES); }
      for (const rel of x.rels) {
        const [t, pat, , r] = rel;
        if (t !== t) continue;
        if (enumed.has(rel)) { pats.push(pat); continue; }
        hi = Math.max(hi, t);
        se += t * Math.sqrt(r / EV_SAMPLES);
      }
      if (se > SE_MAX) sweep.push(x.f);
      else bounded.push({ f: x.f, hi, lo: x.lo, pats });
    }
    bounded.sort((a, b) => a.hi - b.hi);
    let B = 0, lo = 0, boundedU = 0;
    const patterns = new Map();
    for (const x of bounded) {
      if (B + x.hi > cap) { sweep.push(x.f); continue; }
      B += x.hi;
      lo += x.lo;
      if (x.f.some(id => X.pk[id] >= 0)) boundedU++;
      for (const pat of x.pats) patterns.set(JSON.stringify(pat), pat);
    }
    const has = pred => sweep.some(f => f.some(pred));
    const anyAdd = adds.gt || adds.lt || adds.same || adds.dig.some(x => x);
    const sweepQ = {
      ...q, ...this.groupsOf(sweep), fams: sweep, prevValue: adds.pv, adds: anyAdd ? adds : null, evalKey: q.evalKey + '|sweep|' + targets.join(','),
      dynamic: { date: has(id => meta.isDate[id]) ? q.dynamic.date : null, history: has(id => meta.isHistory[id]) ? q.dynamic.history : null },
    };
    return { sweepQ, B, lo, patterns: [...patterns.values()], swept: sweep.length, boundedU, targetsKey: targets.join(',') };
  }

  // 직전 판 문맥으로 점수표 T를 만든다(1억 개). 같은 문맥이면 재사용.
  prepare(state) {
    const key = this.stateKey(state, state.date || kstToday());
    if (state.targets) this.targets = state.targets.slice().sort((a, b) => a - b);
    return this.serial(async () => {
      if (this.prepared && this.prepared.key === key) return this.prepared;
      const t0 = Date.now();
      const { ymd, bounds, hist, X, U, q } = this.buildQuery(state);
      this.prepared = null;
      const targets = this.targets;
      const split = this.fast ? this.splitQuery(q, X, state.prev ? parseRoll(state.prev) : null, hist, ymd, targets) : null;
      let res = null, fast = null;
      if (split) {
        res = await this.engine.query({ ...split.sweepQ, windows: windowsOf(targets, split), candCap: PATCH_MAX / 8 });
        if (!res.overflow) fast = await this.patchBounded(q, split, res, state);
      }
      if (!fast) res = await this.engine.query(q);
      this.prepared = { key, ymd, X, U, hist, bounds, q, ...res, ...(fast ? fast.ctx : {}), fast, ms: Date.now() - t0, groups: (fast ? split.sweepQ : q).groups.length };
      return this.prepared;
    });
  }

  // T를 바꾸는 작업은 하나씩 차례로
  serial(fn) {
    this.preparing = this.preparing.catch(() => {}).then(fn);
    return this.preparing;
  }

  // 훑지 않은 계열 반영: 회귀·재현이 나올 수 있는 숫자와 목표 점수 근처 후보를 정확히 다시 계산
  async patchBounded(q, split, res, state) {
    const list = P.unique(P.concat([res.cand, ...split.patterns.map(P.patternList)]));
    if (list.length > PATCH_MAX) return null;
    await this.engine.patch(q, list);
    // 업적별 평균 문맥 점수: 훑은 계열은 정확한 합, 나머지는 무작위 표본에서
    const sumCtx = Float64Array.from(res.sumCtx), cntCtx = Float64Array.from(res.cntCtx);
    if (split.boundedU) {
      const sp = await this.engine.patch(q, P.sample(SAMPLE_N, rollValue(parseRoll(state.prev)) + 1), { accumulate: true });
      for (let id = 0; id < MAX_ID; id++) if (!cntCtx[id]) { sumCtx[id] = sp.sumCtx[id]; cntCtx[id] = sp.cntCtx[id]; }
    }
    return {
      B: split.B, lo: split.lo, swept: split.swept, patched: list.length, targetsKey: split.targetsKey,
      near: new Map(), ctx: { sumCtx, cntCtx },
    };
  }

  // 분석 직전(빠른 점수표일 때):
  //  - 목표 점수가 바뀌었으면 새 목표 점수 근처 후보를 정확히 다시 계산
  //  - 이번 숫자에서 1~4칸 리롤로 나오는 숫자(약 50만 개)를 정확히 다시 계산 → 대박 노리기·1~4칸 기댓값이 정확
  //  - 5칸 이상 리롤 조합은 무작위 결과로 훑지 않은 계열의 점수 차이 평균을 재서 기댓값을 보정(참고용이라 근사)
  // 돌려주는 값: 칸 조합별 기댓값 보정
  refine(prepared, I) {
    if (!prepared.fast) return Promise.resolve(null);
    return this.serial(async () => {
      const f = prepared.fast;
      if (!f || this.prepared !== prepared) return null;
      const tk = this.targets.join(',');
      if (f.targetsKey !== tk) {
        const cand = await this.engine.scan(windowsOf(this.targets, f));
        if (cand.length > PATCH_MAX) {
          Object.assign(prepared, await this.engine.query(prepared.q), { fast: null });
          return null;
        }
        await this.engine.patch(prepared.q, cand);
        f.targetsKey = tk;
      }
      const ik = I.join('');
      if (!f.near.has(ik)) {
        await this.engine.patch(prepared.q, P.unique(P.neighborhood(I)));
        const masks = [];
        for (let m = 1; m < 256; m++) if (P.popcount(m) >= 5) masks.push(m);
        const seed = rollValue(I) * 7 + 1;
        const { diffs } = await this.engine.patch(prepared.q, P.concat(masks.map(m => P.cubeSample(I, m, EV_SAMPLES, seed + m))), { probe: true });
        const corr = new Float64Array(256);
        masks.forEach((m, i) => { let s = 0; for (let k = i * EV_SAMPLES; k < (i + 1) * EV_SAMPLES; k++) s += diffs[k]; corr[m] = s / EV_SAMPLES; });
        f.near.set(ik, corr);
      }
      return f.near.get(ik);
    });
  }

  // 화면용 내역: 업적별 최고 접두사와 점수, 계열 최댓값만 합산
  breakdown(raw, ymd, hist, X, heart = false) {
    const mk = this.evaluate(raw, ymd, hist);
    const A = this.A, meta = this.meta, v = rollValue(raw);
    const items = [];
    for (const id of meta.live) {
      const m = mk[id];
      if (!m) continue;
      let cands;
      if (meta.isHistory[id]) cands = [{ prefix: '스페셜', score: A.spec[id] }];
      else cands = S.ctxCandidates(A, X, id, v, m, S.packKey(raw, m), heart);
      if (!cands.length) continue;
      items.push({ id, mask: m, ...cands[0], all: cands });
    }
    const bestOfFam = new Map();
    for (const it of items) {
      const f = meta.famIndex[it.id], cur = bestOfFam.get(f);
      if (!cur || it.score > cur.score) bestOfFam.set(f, it);
    }
    let total = 0;
    for (const it of items) {
      it.counted = bestOfFam.get(meta.famIndex[it.id]) === it;
      if (it.counted) total += it.score;
    }
    items.sort((a, b) => b.score - a.score);
    return { total, items };
  }

  // 8칸 전체 리롤 시 강심장/승부사 기댓값 보정(해석적 근사).
  // 최초 숫자 I에서 달성한 업적 d를 다시 달성하면 강심장, 같은 성립 숫자열이면 승부사.
  // 같은 계열에 여러 개면 드문 것부터 "그것을 달성하고 더 드문 것은 못 한" 확률로 나눠 더한다.
  // 8칸 전체 리롤 시 강심장/승부사를 다시 달성할 수 있는 업적들(최초 숫자 I 기준).
  // 강심장: 같은 업적을 다른 성립 숫자로, 승부사: 같은 성립 숫자로 다시 달성.
  heartItems(I, ymd, prepared) {
    const A = this.A, meta = this.meta, st = this.stats;
    const mk = this.evaluate(I, ymd, null);
    const bounds = this.dateBounds(ymd);
    const winSet = new Set(R.WINDOW_IDS);
    const out = [];
    for (const id of meta.live) {
      const hasGang = A.gang[id] === A.gang[id], hasSeung = A.seung[id] === A.seung[id];
      if (!mk[id] || meta.isHistory[id] || (!hasGang && !hasSeung)) continue;
      const count = meta.isDate[id] ? (bounds[id] ? bounds[id].count : 1) : st.count[id];
      if (!count) continue;
      const p = count / 1e8;
      const key = S.packKey(I, mk[id]);
      // 성립 숫자열이 숫자 전체인 업적은 같은 숫자가 다시 나와야 승부사(1억 분의 1).
      // 일부 칸만 쓰는 업적은 빌드 때 모은 성립 숫자열 분포를 쓴다(분포가 너무 커서 버린 업적은 1%로 근사).
      let ps = 1e-8;
      if (winSet.has(id)) ps = st.keys[id] ? Math.max(1, st.keys[id][key] || 0) / 1e8 : p * 0.01;
      ps = Math.min(ps, p);
      const cbar = prepared && prepared.cntCtx[id] > 0 ? prepared.sumCtx[id] / prepared.cntCtx[id] : st.avgBase[id] || A.base[id];
      out.push({ id, fam: meta.famIndex[id], p, ps, seung: hasSeung ? A.seung[id] : A.gang[id], gang: hasGang ? A.gang[id] : null, cbar });
    }
    return out;
  }

  // 기댓값 보정(해석적 근사). 같은 계열에 여러 개면 드문 것부터 "그것을 달성하고 더 드문 것은 못 한" 확률로 나눠 더한다.
  heartBonus(items) {
    const byFam = new Map();
    for (const x of items) {
      const hbar = (x.ps * x.seung + (x.p - x.ps) * (x.gang == null ? x.cbar : x.gang)) / x.p;
      if (!byFam.has(x.fam)) byFam.set(x.fam, []);
      byFam.get(x.fam).push({ p: x.p, gain: Math.max(0, hbar - x.cbar) });
    }
    let bonus = 0;
    for (const list of byFam.values()) {
      list.sort((a, b) => a.p - b.p);
      let covered = 0;
      for (const x of list) {
        bonus += Math.max(0, x.p - covered) * x.gain;
        covered = Math.max(covered, x.p);
      }
    }
    return bonus;
  }

  // 강심장/승부사 점수만으로 target을 넘길 확률(합집합 근사)
  heartTail(items, target) {
    let p = 0;
    for (const x of items) {
      if (x.seung >= target) p += x.ps;
      if (x.gang != null && x.gang >= target) p += x.p - x.ps;
    }
    return Math.min(1, p);
  }

  // 칸 수(1~4)마다 노릴 수 있는 최고 점수: 그 점수가 가장 높은 칸 조합, 확률, 실제로 그 점수가 나오는 숫자 하나와 주요 업적.
  jackpots(T, I, options, prepared) {
    const out = [];
    for (let k = 1; k <= 4; k++) {
      let pick = null;
      for (const o of options) {
        if (popcount(o.mask) !== k) continue;
        if (!pick || o.max > pick.max || (o.max === pick.max && o.pMax > pick.pMax)) pick = o;
      }
      const example = exampleOf(T, I, pick.mask, pick.max);
      const items = this.breakdown(example, prepared.ymd, prepared.hist, prepared.X).items.filter(it => it.counted);
      out.push({ k, ...pick, example, items });
    }
    return out;
  }

  // 목표 점수들을 넘길 확률. 목표마다 1~8칸 리롤 255가지 전체에서 가장 높은 조합을 고르고,
  // 확률이 같으면 더 높은 목표를 넘길 확률이 큰 조합, 그다음 적은 칸 수를 고른다.
  // 8칸 전체 리롤은 강심장/승부사 점수만으로 넘기는 경우(근사)를 더한다.
  goals(T, I, targets, keepTotal, heart) {
    const th = targets.slice().sort((a, b) => a - b), L = th.length;
    const lv = subsetLevels(T, I, th);
    const full = th.map((t, i) => Math.min(1, lv[255 * L + i] + this.heartTail(heart, t)));
    const P = (m, i) => (m === 255 ? full[i] : lv[m * L + i]);
    const better = (a, b, i) => {
      for (let t = i; t < L; t++) { const x = P(a, t), y = P(b, t); if (x !== y) return x > y; }
      return popcount(a) < popcount(b);
    };
    return th.map((target, i) => {
      let best = 1;
      const byK = [];
      for (let m = 1; m < 256; m++) {
        if (better(m, best, i)) best = m;
        const k = popcount(m);
        if (!byK[k] || better(m, byK[k], i)) byK[k] = m;
      }
      const rows = byK.slice(1).map(m => ({ k: popcount(m), mask: m, p: P(m, i) }));
      const first = rows.find(r => r.p > 0);
      let rec;
      if (keepTotal >= target) rec = { type: 'keep' };
      else if (P(best, i) > 0) rec = { type: 'reroll', k: popcount(best), mask: best, p: P(best, i) };
      else rec = { type: 'none' };
      return { target, rec, byK: rows, minK: first ? first.k : null };
    });
  }

  // 희귀 업적 찬스: 1~4칸 리롤로 딸 수 있는 등급 minTier 이상 (접두사, 업적)마다 가장 확률 높은 조합
  async rare(I, prepared, minTier) {
    const counts = await this.engine.rare({
      I: Array.from(I), minTier, bounds: prepared.bounds,
      dynamic: { date: prepared.ymd, history: prepared.hist },
      ctx: { pk: Array.from(prepared.X.pk), pm: Array.from(prepared.X.pm) },
    });
    const best = new Map();
    for (const [code, n] of counts) {
      const mask = Math.floor(code / 8192), p = Math.floor(code / 512) % 16, id = code % 512, k = popcount(mask);
      const prob = n / 10 ** k, key = p * 512 + id, cur = best.get(key);
      if (!cur || prob > cur.prob || (prob === cur.prob && k < cur.k)) best.set(key, { prefix: PREFIXES[p], id, mask, k, prob });
    }
    const raw = this.meta.raw;
    const list = [...best.values()].map(x => ({ ...x, tier: raw.rarityByPrefix[x.prefix][x.id], score: Number(raw.scores[x.prefix][x.id]) }));
    list.sort((a, b) => b.tier - a.tier || b.prob - a.prob);
    return list;
  }

  async analyze(I, state) {
    const prepared = await this.prepare(state);
    const t0 = Date.now();
    const evCorr = await this.refine(prepared, I);
    const { ymd, X, hist } = prepared;
    this.applyBounds(prepared.bounds);
    const keepCtx = { ...X, noReroll: true };
    const keep = this.breakdown(I, ymd, hist, keepCtx);
    const T = prepared.T;
    const ev = subsetReduce(T, I, 'mean');
    if (evCorr) for (let m = 1; m < 256; m++) ev[m] += evCorr[m];
    const { max: best, count: bestCount } = subsetMaxCount(T, I);
    const heartList = this.heartItems(I, ymd, prepared);
    const heart = this.heartBonus(heartList);
    ev[255] += heart;
    const options = [];
    for (let m = 1; m < 256; m++) options.push({ mask: m, ev: ev[m], max: best[m], pMax: bestCount[m] / 10 ** popcount(m) });
    const jackpots = this.jackpots(T, I, options, prepared);
    const goals = this.goals(T, I, this.targets, keep.total, heartList);
    const rare = await this.rare(I, prepared, state.rareTier == null ? 5 : state.rareTier);
    options.sort((a, b) => b.ev - a.ev);
    return { I, keep, options, jackpots, goals, rare, heart, prepared, ms: Date.now() - t0 };
  }
}

module.exports = { Helper, kstToday, parseRoll, rollStr, rollValue, PREFIXES, DEFAULT_TARGETS };

};
defs["format"] = function (module, exports, require, __dirname, __filename) {
'use strict';
// CLI와 웹 화면이 함께 쓰는 표시·기록 함수
const { parseRoll, rollStr, rollValue } = require('./analyze');

function parseStreaks(s) {
  if (!s) return null;
  const a = Array(10).fill(0);
  for (const part of String(s).split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d)[=:](\d+)$/);
    if (!m) throw new Error(`연속 기록 형식: 0=3,5=9 (숫자=연속 판 수) — "${part}"`);
    a[+m[1]] = +m[2];
  }
  return a;
}

const fmt = x => {
  if (!isFinite(x)) return '-';
  const a = Math.abs(x);
  return x.toLocaleString('ko-KR', { maximumFractionDigits: a >= 100 ? 0 : 1 });
};
const pct = x => (x * 100).toFixed(x >= 0.995 || x === 0 ? 0 : x < 0.01 ? 2 : 1) + '%';

function tierName(meta, prefix, id) {
  const idx = meta.raw.rarityByPrefix[prefix]?.[id];
  return idx == null ? '' : meta.raw.rarityTiers[idx]?.name || '';
}

function shape(I, mask) {
  return Array.from(I, (d, j) => ((mask >> j) & 1 ? '*' : String(d))).join('');
}
function slots(mask) {
  const s = [];
  for (let j = 0; j < 8; j++) if ((mask >> j) & 1) s.push(j + 1);
  return s.length === 8 ? '8칸 전체' : s.join(',') + '번째 칸';
}

function recordFinal(state, digits) {
  const F = parseRoll(digits);
  if (!F) throw new Error('확정 숫자는 최대 8자리 숫자로 입력하세요.');
  const v = rollValue(F);
  if (state.prev) {
    const pv = rollValue(parseRoll(state.prev));
    if (v > pv) { state.asc = (state.asc || 1) + 1; state.desc = 1; }
    else if (v < pv) { state.desc = (state.desc || 1) + 1; state.asc = 1; }
    else { state.asc = 1; state.desc = 1; }
  } else { state.asc = 1; state.desc = 1; }
  const sig = String(v);
  state.streaks = (state.streaks || Array(10).fill(0)).map((s, d) => (sig.includes(String(d)) ? s + 1 : 0));
  state.prev = rollStr(F);
  state.history = [...(state.history || []), state.prev].slice(-200);
}

function statusText(state) {
  const st = state.streaks ? state.streaks.map((s, d) => `${d}:${s}`).join(' ') : '모름';
  return `직전 판 ${state.prev || '없음'} · 상승 ${state.asc || 1}연속 · 하락 ${state.desc || 1}연속 · 숫자별 연속 포함 [${st}] · 날짜 ${state.date || '오늘(한국 시간)'}`;
}

// 확률: 1% 이상은 퍼센트, 그보다 작으면 "1/N"
function odds(p) {
  if (!(p > 0)) return '0';
  return p >= 0.01 ? pct(p) : '1/' + Math.round(1 / p).toLocaleString('ko-KR');
}

// 큰 점수를 한국어 단위로: 1억, 10억, 2.5조
function krAmount(x) {
  const units = [[1e16, '경'], [1e12, '조'], [1e8, '억'], [1e4, '만']];
  for (const [u, name] of units) if (x >= u) return +(x / u).toPrecision(3) + name;
  return String(x);
}
// "1억, 10억", "5000만", "100000000" → 숫자 목록
function parseAmounts(text) {
  const mult = { 경: 1e16, 조: 1e12, 억: 1e8, 만: 1e4 };
  const out = [];
  for (const part of String(text).split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^([\d.]+)(경|조|억|만)?$/);
    if (!m) throw new Error(`목표 점수 형식: 1억, 10억, 5000만 — "${part}"`);
    out.push(Number(m[1]) * (m[2] ? mult[m[2]] : 1));
  }
  return out.sort((a, b) => a - b);
}

module.exports = { parseStreaks, fmt, pct, odds, krAmount, parseAmounts, tierName, shape, slots, recordFinal, statusText };

};
  g.RandleCore = { require: req };
})(typeof self !== 'undefined' ? self : this);
