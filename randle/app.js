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
  const DEFAULT_TARGETS = [1e8, 1e9, 1e10, 1e11];
  const settings = Object.assign({ top: 10, mijeong: 'separate', targets: DEFAULT_TARGETS, rareTier: 5 }, load(SET_KEY, {}));
  if (String(settings.targets) === String([1e8, 1e9])) settings.targets = DEFAULT_TARGETS; // 예전 기본값은 새 기본값으로
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
      const info = await engine.init(raw, { mijeong: settings.mijeong }, p => {
        $('setup').hidden = false;
        $('setup-note').hidden = p.stage === 'load';
        setupProgress(p);
      });
      if (info.saveError) showError(`계산 결과를 브라우저에 저장하지 못했습니다(${info.saveError}). 저장 공간을 확인해 주세요. 다음에 열 때 다시 계산합니다.`);
      helper = new Helper(engine, { meta: engine.meta, stats: engine.stats });
      fillSettings();
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
      load: '이 브라우저에 저장된 계산 불러오는 중 (다운로드 아님)',
      tables: '조회 테이블 만드는 중 (소수·소인수 등)',
      build: `기본 점수표 계산 중 (1억 개) ${pct.toFixed(0)}%`,
      save: '다음에 바로 열 수 있게 브라우저에 저장하는 중',
    }[p.stage];
    $('setup-text').textContent = label + (p.stage === 'tables' && p.text ? ` · ${p.text.trim()}` : '');
    const why = {
      first: '처음 방문이라 한 번 계산합니다. 결과(약 530MB)는 이 브라우저에 저장되어 다음부터는 몇 초 안에 열립니다.',
      update: '계산 방식이 업데이트되어 한 번 다시 계산합니다. 결과는 다시 저장되어 다음부터는 몇 초 안에 열립니다.',
      evicted: '저장해 둔 계산이 브라우저에서 지워져(저장 공간 정리 등) 다시 계산합니다.',
      nodb: '이 브라우저 창은 저장소를 쓸 수 없어(시크릿 창 등) 열 때마다 계산합니다.',
    }[p.reason];
    if (why) $('setup-note').textContent = why;
  }

  // 직전 판 기준 점수표를 미리 만든다(10~20초)
  function warm() {
    if (!helper) return Promise.resolve();
    $('prep').hidden = false;
    $('prep-text').textContent = state.prev
      ? `직전 판(${state.prev}) 기준 점수표 계산 중… 직전 판에 따라 달라서 열 때마다·기록할 때마다 계산합니다(10~20초).`
      : '점수표 준비 중…';
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
    $('set-targets').value = settings.targets.map(F.krAmount).join(', ');
    if (raw && !$('set-rare').options.length) raw.rarityTiers.forEach((t, i) => $('set-rare').add(new Option(t.name + ' 이상', i)));
    $('set-rare').value = settings.rareTier;
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
  // 접두사 배지 + 업적 이름. 마우스를 올리면(또는 탭하면) 업적 설명 툴팁.
  function achLabel(prefix, id) {
    return `<span class="ach-name" tabindex="0" data-tip="${esc(prefix)}:${id}">${badge(prefix)} ${esc(helper.meta.defs[id].name)}</span>`;
  }
  function tipHtml(prefix, id) {
    const d = helper.meta.defs[id];
    const idx = raw.rarityByPrefix[prefix] && raw.rarityByPrefix[prefix][id], t = idx == null ? null : raw.rarityTiers[idx];
    const sc = raw.scores[prefix] && raw.scores[prefix][id];
    const q = d.count ? d.count / 1e8 : d.initial;
    const lines = [`<div class="tip-head">${badge(prefix)} <b>${esc(d.name)}</b>${d.emoji ? ' ' + esc(d.emoji) : ''}</div>`];
    lines.push(`<div class="tip-meta">${t ? `<span style="color:${t.color}">${esc(t.name)}</span> · ` : ''}${sc != null ? F.fmt(Number(sc)) + ' RP' : ''}${helper.meta.estimated.has(id) ? ' (추정)' : ''} · ${d.history ? '설계 확률' : '뽑을 확률'} ${esc(F.odds(q))}</div>`);
    lines.push(`<div>${esc(d.condition)}</div>`);
    if (d.description && d.description !== d.condition) lines.push(`<div class="tip-sub">${esc(d.description)}</div>`);
    if (d.example) lines.push(`<div class="tip-sub">예: ${esc(d.example)}</div>`);
    const help = raw.prefixDescriptions && raw.prefixDescriptions[prefix];
    if (help && prefix !== '기본') lines.push(`<div class="tip-sub">[${esc(displayPrefix(prefix))}] ${esc(help)}</div>`);
    return lines.join('');
  }

  function tier(prefix, id) {
    const idx = raw.rarityByPrefix[prefix] && raw.rarityByPrefix[prefix][id];
    const t = idx == null ? null : raw.rarityTiers[idx];
    return t ? `<span class="tier" style="color:${t.color}">${esc(t.name)}</span>` : '';
  }

  function render(res) {
    const I = res.I, keep = res.keep.total, top = Math.max(1, settings.top | 0);
    const name = id => esc(helper.meta.defs[id].name);
    const estTag = id => (helper.meta.estimated.has(id) ? '<span class="est">추정</span>' : '');
    const parts = [];
    // 목표 점수
    for (const g of res.goals) {
      const r = g.rec, label = `${F.krAmount(g.target)} 이상`;
      let main;
      if (r.type === 'keep') main = `<div>${digitsHtml(I, 0, true)}</div><div class="verdict-main">${label}: 지금 확정하면 이미 넘습니다 <span class="num">✓</span></div>`;
      else if (r.type === 'reroll') main = `<div>${digitsHtml(I, r.mask, true)}</div><div class="verdict-main">${label}: ${esc(F.slots(r.mask))} 리롤 · 확률 <span class="num">${esc(F.odds(r.p))}</span>${g.minK && g.minK < r.k ? ` <span class="muted">(최소 ${g.minK}칸부터 가능)</span>` : ''}</div>`;
      else main = `<div class="verdict-main">${label}: <span class="muted">어떻게 리롤해도 불가능</span></div>`;
      // 칸 수별 최고 조합: 마우스를 올리면 리롤할 칸 모양(*)을 보여준다
      const byK = r.type === 'none' ? '' : g.byK.map(x => `<span class="kchip${r.type === 'reroll' && r.mask === x.mask ? ' on' : ''}"${x.p > 0 ? ` title="${esc(F.shape(I, x.mask))}"` : ''}>${x.k}칸 <b>${x.p > 0 ? esc(F.odds(x.p)) : '불가'}</b></span>`).join('');
      parts.push(`<div class="verdict">${main}${byK ? `<div class="kchips">${byK}</div>` : ''}</div>`);
    }
    // 대박 노리기 (1~4칸)
    const jrows = res.jackpots.map(j => `<tr>
      <td>${j.k}칸</td><td>${digitsHtml(I, j.mask)}</td><td class="num">${esc(F.krAmount(j.max))}</td><td class="num">${esc(F.odds(j.pMax))}</td>
      <td>${j.example ? digitsHtml(j.example, 0) : '-'}</td>
      <td class="jp-items">${j.items.slice(0, 3).map(it => `<span class="jp-item">${achLabel(it.prefix, it.id)}</span>`).join('')}</td></tr>`).join('');
    parts.push(`<div class="jackpot"><h3>대박 노리기</h3><p class="note">그 칸 수만큼 리롤할 때 노릴 수 있는 최고 점수와 확률, 그 점수가 나오는 숫자</p>
      <div class="table-wrap"><table class="jp">
      <thead><tr><th>칸 수</th><th>리롤할 칸</th><th>최고 RP</th><th>확률</th><th>나오면 대박인 숫자</th><th>주요 업적</th></tr></thead>
      <tbody>${jrows}</tbody></table></div></div>`);
    // 희귀 업적 찬스
    const tierName = raw.rarityTiers[settings.rareTier].name;
    const rrows = res.rare.slice(0, top).map(x => `<tr>
      <td class="jp-items"><span class="jp-item">${achLabel(x.prefix, x.id)}</span>${tier(x.prefix, x.id)}${estTag(x.id)}</td>
      <td>${digitsHtml(I, x.mask)}</td><td class="num">${esc(F.odds(x.prob))}</td><td class="num">${esc(F.krAmount(x.score))}</td></tr>`).join('');
    parts.push(`<div class="jackpot"><h3>희귀 업적 찬스</h3><p class="note">1~4칸 리롤로 딸 수 있는 ${esc(tierName)} 이상 업적 (등급 높은 순)</p>
      ${res.rare.length ? `<div class="table-wrap"><table class="rare"><thead><tr><th>업적</th><th>리롤할 칸</th><th>확률</th><th>RP</th></tr></thead><tbody>${rrows}</tbody></table></div>` : '<p class="muted">없음</p>'}</div>`);
    // 그대로 확정
    const items = res.keep.items.map(it => `<li${it.counted ? '' : ' class="excluded"'}>${achLabel(it.prefix, it.id)}${tier(it.prefix, it.id)}${estTag(it.id)}
      <span class="score">${F.fmt(it.score)} RP${it.counted ? '' : ' · 합산 제외'}</span></li>`).join('');
    parts.push(`<details class="keep"><summary>그대로 확정하면 <b>${F.fmt(keep)}</b> RP (${esc(F.krAmount(keep))})</summary><ul class="ach">${items}</ul></details>`);
    // 기댓값 참고
    const rows = res.options.slice(0, 10).map((o, i) => `<tr><td>${i + 1}</td><td>${digitsHtml(I, o.mask)}</td><td>${esc(F.slots(o.mask))}</td><td class="num">${F.fmt(o.ev)}</td></tr>`).join('');
    parts.push(`<details class="keep"><summary>기댓값 순 (참고)</summary><div class="table-wrap"><table>
      <thead><tr><th>순위</th><th>결과 모양</th><th>리롤할 칸</th><th>기댓값 RP</th></tr></thead><tbody>${rows}</tbody></table></div></details>`);
    const notes = [];
    if (helper.meta.estimated.size) notes.push(`'추정' 표시 업적은 게임이 점수를 공개하지 않아 공식으로 추정한 점수입니다.`);
    notes.push('8칸 전체 리롤 확률에는 강심장/승부사로 넘기는 경우가 근사로 포함됩니다.');
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
      const res = await helper.analyze(I, { ...state, targets: settings.targets, rareTier: settings.rareTier });
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
      settings.targets = $('set-targets').value.trim() ? F.parseAmounts($('set-targets').value) : DEFAULT_TARGETS;
      if ($('set-rare').value !== '') settings.rareTier = +$('set-rare').value;
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

  // ---------- 툴팁 ----------
  const tip = $('tip');
  let tipFor = null;
  function showTip(el) {
    const [prefix, id] = el.dataset.tip.split(':');
    tip.innerHTML = tipHtml(prefix, +id);
    tip.hidden = false;
    tipFor = el;
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const top = r.bottom + 8 + h <= window.innerHeight ? r.bottom + 6 : Math.max(8, r.top - h - 6);
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  function hideTip() { tip.hidden = true; tipFor = null; }
  document.addEventListener('mouseover', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el && el !== tipFor) showTip(el); else if (!el && tipFor) hideTip(); });
  document.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el); });
  document.addEventListener('focusout', hideTip);
  document.addEventListener('click', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el); else hideTip(); });
  window.addEventListener('scroll', hideTip, true);

  // ---------- 시작 ----------
  if (load(UNLOCK_KEY, null) === RANDLE.pw) openApp();
  else $('pw').focus();
})();
