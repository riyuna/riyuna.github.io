'use strict';
// 화면: 비밀번호 → (처음이면) 점수표 준비 → 숫자 분석/확정 기록. 계산은 CLI와 같은 lib/ 코드(randle-core.js)를 쓴다.
(function () {
  const core = RandleCore.require;
  const { Helper, parseRoll, rollValue } = core('analyze');
  const F = core('format');
  const { displayPrefix } = core('meta');
  const $ = id => document.getElementById(id);
  const STATE_KEY = 'randle-state', SET_KEY = 'randle-settings', UNLOCK_KEY = 'randle-unlock';

  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가(사생활 보호 모드 등) */ } };
  let state = load(STATE_KEY, { prev: null, asc: 1, desc: 1, streaks: null, history: [], date: null });
  const settings = Object.assign({ top: 10, mijeong: 'separate' }, load(SET_KEY, {}));
  let engine = null, helper = null, raw = null;

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  function showError(msg) { const el = $('error'); el.textContent = msg; el.hidden = !msg; }

  // ---------- 잠금 ----------
  async function sha256(text) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
  }
  function openApp() {
    $('lock').hidden = true;
    $('app').hidden = false;
    renderStatus();
    fillSettings();
    start();
  }
  $('lock-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!window.isSecureContext) { $('lock-msg').textContent = 'https 주소로 열어 주세요.'; return; }
    if ((await sha256('randle:' + $('pw').value)) === RANDLE.pw) { save(UNLOCK_KEY, RANDLE.pw); openApp(); }
    else { $('lock-msg').textContent = '비밀번호가 맞지 않습니다.'; $('pw').select(); }
  });
  $('btn-lock').addEventListener('click', () => { localStorage.removeItem(UNLOCK_KEY); location.reload(); });

  // ---------- 준비 ----------
  async function start() {
    if (!window.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
      showError('이 창에서는 공유 메모리(SharedArrayBuffer)를 쓸 수 없습니다. 새로고침해 보고, 그래도 안 되면 데스크톱 Chrome·Edge·Firefox에서 열어 주세요.');
      return;
    }
    if (navigator.deviceMemory && navigator.deviceMemory < 4) showError('메모리가 약 1GB 필요합니다. 이 기기에서는 느리거나 멈출 수 있습니다.');
    const t0 = performance.now();
    const timer = setInterval(() => { $('setup-time').textContent = Math.round((performance.now() - t0) / 1000) + '초'; }, 500);
    try {
      raw = await (await fetch('randle_data.json?v=' + RANDLE.version)).json();
      engine = new WebEngine({ version: RANDLE.version, cacheKey: RANDLE.core });
      await engine.init(raw, { mijeong: settings.mijeong }, p => {
        $('setup').hidden = false;
        $('setup-note').hidden = p.stage === 'load';
        setupProgress(p);
      });
      helper = new Helper(engine, { meta: engine.meta, stats: engine.stats });
      engine.onQueryProgress = (d, n) => { $('prep-bar').style.width = ((d / n) * 100).toFixed(1) + '%'; };
      $('setup').hidden = true;
      $('btn-roll').disabled = false;
      $('roll').focus();
      warm();
    } catch (err) {
      console.error(err);
      showError('준비 중 오류: ' + err.message);
    } finally {
      clearInterval(timer);
    }
  }

  function setupProgress(p) {
    const bar = $('setup-bar').parentElement;
    bar.classList.toggle('indeterminate', p.stage === 'tables');
    const pct = p.total ? (p.done / p.total) * 100 : 0;
    $('setup-bar').style.width = pct.toFixed(1) + '%';
    const label = {
      load: '저장된 계산 불러오는 중',
      tables: '조회 테이블 만드는 중 (소수·소인수 등)',
      build: `기본 점수표 계산 중 (1억 개) ${pct.toFixed(0)}%`,
      save: '브라우저에 저장하는 중',
    }[p.stage];
    $('setup-text').textContent = label + (p.stage === 'tables' && p.text ? ` · ${p.text.trim()}` : '');
  }

  // 직전 판 기준 점수표를 미리 만든다(10~20초)
  function warm() {
    if (!helper) return Promise.resolve();
    $('prep').hidden = false;
    $('prep-text').textContent = '직전 판 기준 점수표 준비 중…';
    const p = helper.prepare(state);
    p.then(() => { if (helper.prepared) $('prep').hidden = true; }).catch(err => showError('점수표 준비 오류: ' + err.message));
    return p;
  }

  // ---------- 상태 ----------
  function renderStatus() {
    const chips = [
      ['직전 판', state.prev || '없음'],
      ['상승', `${state.asc || 1}연속`],
      ['하락', `${state.desc || 1}연속`],
      ['날짜', state.date || '오늘'],
    ];
    if (state.streaks) chips.push(['숫자별 연속', state.streaks.map((s, d) => `${d}:${s}`).join(' ')]);
    $('status').innerHTML = chips.map(([k, v]) => `<span class="chip">${esc(k)} <b>${esc(v)}</b></span>`).join('');
  }
  function persist() { save(STATE_KEY, state); renderStatus(); fillSettings(); }
  function fillSettings() {
    $('set-prev').value = state.prev || '';
    $('set-asc').value = state.asc || 1;
    $('set-desc').value = state.desc || 1;
    $('set-date').value = state.date || '';
    $('set-streaks').value = state.streaks ? state.streaks.map((s, d) => `${d}=${s}`).join(' ') : '';
    $('set-top').value = settings.top;
    $('set-mijeong').value = settings.mijeong;
  }

  // ---------- 분석 ----------
  const digitsHtml = (I, mask, big) =>
    `<span class="digits${big ? ' big' : ''}">${Array.from(I, (d, j) => `<span${(mask >> j) & 1 ? ' class="r"' : ''}>${d}</span>`).join('')}</span>`;
  const BADGE = {
    단판: ['#e8bd4b', '#45310b'], 강심장: ['#95243b', '#ffe9ed'], 승부사: ['#aa3038', '#fff1df'], 연쇄: ['#28704b', '#e1ffe9'],
    재현: ['#234f86', '#e7fdff'], 동형: ['#99522c', '#fff1e4'], 회귀: ['#713778', '#fff2ff'], 스페셜: ['#e6eef8', '#29374d'],
    여명: ['#3d4f7a', '#e6ecff'], 절정: ['#7a4f3d', '#fff0e6'], 태초: ['#2f6f73', '#e6fffd'], 극한: ['#7a3d63', '#ffe6f5'],
  };
  function badge(prefix) {
    const [bg, fg] = BADGE[prefix] || ['#2a3044', '#e6e9f2'];
    return `<span class="badge" style="background:${bg};color:${fg}">${esc(displayPrefix(prefix))}</span>`;
  }
  function tier(prefix, id) {
    const idx = raw.rarityByPrefix[prefix] && raw.rarityByPrefix[prefix][id];
    const t = idx == null ? null : raw.rarityTiers[idx];
    return t ? `<span class="tier" style="color:${t.color}">${esc(t.name)}</span>` : '';
  }

  function render(res) {
    const I = res.I, keep = res.keep.total, best = res.options[0], top = Math.max(1, settings.top | 0);
    const parts = [];
    if (best.ev > keep) {
      const safe = res.options.filter(o => o.ev > keep).sort((a, b) => b.pBetter - a.pBetter)[0];
      parts.push(`<div class="verdict">
        <div>${digitsHtml(I, best.mask, true)}</div>
        <div class="verdict-main">${esc(F.slots(best.mask))} 리롤 · 기댓값 <span class="num">${F.fmt(best.ev)}</span> RP
          <span class="muted">(확정 ${F.fmt(keep)} RP 대비 +${F.fmt(best.ev - keep)})</span></div>
        ${safe && safe.mask !== best.mask && safe.pBetter > best.pBetter + 0.05
          ? `<div class="note">안정형: ${digitsHtml(I, safe.mask)} ${esc(F.slots(safe.mask))} 리롤 — 확정보다 높을 확률 ${F.pct(safe.pBetter)}, 기댓값 ${F.fmt(safe.ev)} RP</div>` : ''}
      </div>`);
    } else {
      parts.push(`<div class="verdict"><div>${digitsHtml(I, 0, true)}</div>
        <div class="verdict-main">리롤하지 말고 확정 · <span class="num">${F.fmt(keep)}</span> RP
          <span class="muted">(가장 좋은 리롤의 기댓값 ${F.fmt(best.ev)} RP)</span></div></div>`);
    }
    const rows = res.options.slice(0, top).map((o, i) => `<tr${i === 0 ? ' class="best"' : ''}>
      <td>${i + 1}</td><td>${digitsHtml(I, o.mask)}</td><td>${esc(F.slots(o.mask))}</td>
      <td class="num">${F.fmt(o.ev)}</td><td class="num">${F.pct(o.pBetter)}</td><td class="num">${F.fmt(o.max)}</td></tr>`).join('');
    parts.push(`<div class="table-wrap"><table>
      <thead><tr><th>순위</th><th>결과 모양</th><th>리롤할 칸</th><th>기댓값 RP</th><th>확정보다 높을 확률</th><th>최대 RP</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`);
    const jrows = res.jackpots.map(j => `<tr>
      <td>${j.k}칸</td><td>${digitsHtml(I, j.mask)}</td><td class="num">${F.fmt(j.max)}</td><td class="num">${esc(F.odds(j.pMax))}</td>
      <td>${j.example ? digitsHtml(j.example, 0) : '-'}</td>
      <td class="jp-items">${j.items.slice(0, 3).map(it => `<span class="jp-item">${badge(it.prefix)} ${esc(helper.meta.defs[it.id].name)}</span>`).join('')}</td></tr>`).join('');
    parts.push(`<div class="jackpot"><h3>칸 수별 대박</h3><p class="note">그 칸 수만큼 리롤할 때 노릴 수 있는 최고 점수와 그 확률, 그 점수가 나오는 숫자</p>
      <div class="table-wrap"><table class="jp">
      <thead><tr><th>칸 수</th><th>리롤할 칸</th><th>최고 RP</th><th>확률</th><th>나오면 대박인 숫자</th><th>주요 업적</th></tr></thead>
      <tbody>${jrows}</tbody></table></div></div>`);
    const items = res.keep.items.map(it => `<li${it.counted ? '' : ' class="excluded"'}>${badge(it.prefix)}
      <span>${esc(helper.meta.defs[it.id].name)}</span>${tier(it.prefix, it.id)}${helper.meta.estimated.has(it.id) ? '<span class="est">추정</span>' : ''}
      <span class="score">${F.fmt(it.score)} RP${it.counted ? '' : ' · 합산 제외'}</span></li>`).join('');
    parts.push(`<details class="keep" open><summary>그대로 확정하면 <b>${F.fmt(keep)}</b> RP</summary><ul class="ach">${items}</ul></details>`);
    const notes = [];
    if (helper.meta.estimated.size) notes.push(`'추정' 표시 업적 ${helper.meta.estimated.size}종은 게임이 점수를 공개하지 않아 공식으로 추정한 점수입니다.`);
    if (res.heart > 0) notes.push(`8칸 전체 리롤 기댓값에는 강심장/승부사 보정 +${F.fmt(res.heart)} RP(근사)가 포함되어 있습니다.`);
    notes.push(`점수표 준비 ${(res.prepared.ms / 1000).toFixed(1)}초 · 분석 ${(res.ms / 1000).toFixed(1)}초`);
    parts.push(`<p class="note">${notes.map(esc).join('<br>')}</p>`);
    $('result').innerHTML = parts.join('');
  }

  $('roll-form').addEventListener('submit', async e => {
    e.preventDefault();
    const I = parseRoll($('roll').value);
    if (!I) { showError('이번 판 숫자는 최대 8자리 숫자로 입력하세요.'); return; }
    showError('');
    $('btn-roll').disabled = true;
    $('result').innerHTML = `<p class="muted">${helper.prepared ? '분석 중…' : '직전 판 기준 점수표를 기다리는 중…'}</p>`;
    await nextFrame();
    try {
      const res = await helper.analyze(I, state);
      $('prep').hidden = true;
      render(res);
      $('final').value = '';
    } catch (err) {
      console.error(err);
      showError('분석 오류: ' + err.message);
    } finally {
      $('btn-roll').disabled = false;
    }
  });

  $('final-form').addEventListener('submit', e => {
    e.preventDefault();
    try {
      F.recordFinal(state, $('final').value);
      persist();
      $('final').value = '';
      $('roll').value = '';
      $('result').innerHTML = '';
      warm();
      $('roll').focus();
    } catch (err) { showError(err.message); }
  });

  // ---------- 설정 ----------
  $('btn-save').addEventListener('click', () => {
    try {
      const prev = $('set-prev').value.trim(), date = $('set-date').value.trim();
      if (prev && !parseRoll(prev)) throw new Error('직전 판은 최대 8자리 숫자');
      if (date && !/^\d{8}$/.test(date)) throw new Error('날짜는 YYYYMMDD');
      state.prev = prev ? String(rollValue(parseRoll(prev))).padStart(8, '0') : null;
      state.asc = Math.max(1, +$('set-asc').value || 1);
      state.desc = Math.max(1, +$('set-desc').value || 1);
      state.date = date || null;
      state.streaks = F.parseStreaks($('set-streaks').value.trim());
      settings.top = Math.max(1, Math.min(50, +$('set-top').value || 10));
      const mij = $('set-mijeong').value;
      if (mij !== settings.mijeong) {
        if (!confirm("'미정' 계열 설정을 바꾸면 기본 점수표를 다시 계산합니다(1~3분). 계속할까요?")) { fillSettings(); return; }
        settings.mijeong = mij;
        save(SET_KEY, settings);
        persist();
        location.reload();
        return;
      }
      save(SET_KEY, settings);
      persist();
      showError('');
      warm();
    } catch (err) { showError(err.message); }
  });
  $('btn-clear').addEventListener('click', () => {
    Object.assign(state, { prev: null, asc: 1, desc: 1, streaks: null });
    persist();
    warm();
  });
  $('btn-cache').addEventListener('click', async () => {
    if (!confirm('브라우저에 저장된 계산(약 530MB)을 지웁니다. 다음에 열 때 다시 계산합니다.')) return;
    await WebEngine.clearCache();
    location.reload();
  });

  // ---------- 시작 ----------
  if (load(UNLOCK_KEY, null) === RANDLE.pw) openApp();
  else $('pw').focus();
})();
