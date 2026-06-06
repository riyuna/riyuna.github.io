---
layout: single
title: " "
permalink: /riyuna/baseball/
author_profile: true
---

<div class="lang-block" data-lang="ko" markdown="1">

## ⚾ 은하수수학학원 KBO 승부예측

> 이 페이지는 KBO 승부예측 결과 및 적중률을 공시하는 페이지입니다.

---

## 현재 시즌

| 항목 | 내용 |
|------|------|
| 시즌 | 2026 KBO 리그 |
| 응원팀 | 삼성 라이온즈 |
| 마지막 업데이트 | <span id="ko-updated">—</span> |

---

## 오늘 예측

<div id="ko-today"><em>로딩 중...</em></div>

---

## 은하수수학학원 적중률

| 구분 | 예측 수 | 적중 | 적중률 |
|------|---------|------|--------|
| 전체 | <span id="ko-total-n">—</span> | <span id="ko-total-ok">—</span> | <span id="ko-total-pct">—</span> |
| 이번 달 | <span id="ko-month-n">—</span> | <span id="ko-month-ok">—</span> | <span id="ko-month-pct">—</span> |
| 이번 주 | <span id="ko-week-n">—</span> | <span id="ko-week-ok">—</span> | <span id="ko-week-pct">—</span> |

---

## 팀별 예측 기록

<div id="ko-by-team"><em>로딩 중...</em></div>

---

## 최근 예측 기록

<div id="ko-recent"><em>로딩 중...</em></div>

</div>

<div class="lang-block" data-lang="en" style="display:none" markdown="1">

## ⚾ Milkyway Math Cram KBO Predictions

> This page publishes KBO game prediction results and accuracy statistics.

---

## Current Season

| Item | Value |
|------|-------|
| Season | 2026 KBO League |
| Favorite Team | Samsung Lions |
| Last Updated | <span id="en-updated">—</span> |

---

## Today's Predictions

<div id="en-today"><em>Loading...</em></div>

---

## Milkyway Math Cram Accuracy

| Category | Predictions | Correct | Accuracy |
|----------|-------------|---------|----------|
| Overall | <span id="en-total-n">—</span> | <span id="en-total-ok">—</span> | <span id="en-total-pct">—</span> |
| This month | <span id="en-month-n">—</span> | <span id="en-month-ok">—</span> | <span id="en-month-pct">—</span> |
| This week | <span id="en-week-n">—</span> | <span id="en-week-ok">—</span> | <span id="en-week-pct">—</span> |

---

## By Team

<div id="en-by-team"><em>Loading...</em></div>

---

## Recent Predictions

<div id="en-recent"><em>Loading...</em></div>

</div>

<div class="lang-block" data-lang="ja" style="display:none" markdown="1">

## ⚾ 銀河数数学学習塾 KBO 勝敗予想

> このページはKBO試合の勝敗予想結果と的中率を公示するページです。

---

## 現在のシーズン

| 項目 | 内容 |
|------|------|
| シーズン | 2026 KBOリーグ |
| 応援チーム | サムスン・ライオンズ |
| 最終更新 | <span id="ja-updated">—</span> |

---

## 本日の予想

<div id="ja-today"><em>読み込み中...</em></div>

---

## 銀河数数学学習塾 的中率

| 区分 | 予想数 | 的中 | 的中率 |
|------|--------|------|--------|
| 全体 | <span id="ja-total-n">—</span> | <span id="ja-total-ok">—</span> | <span id="ja-total-pct">—</span> |
| 今月 | <span id="ja-month-n">—</span> | <span id="ja-month-ok">—</span> | <span id="ja-month-pct">—</span> |
| 今週 | <span id="ja-week-n">—</span> | <span id="ja-week-ok">—</span> | <span id="ja-week-pct">—</span> |

---

## チーム別予想記録

<div id="ja-by-team"><em>読み込み中...</em></div>

---

## 最近の予想記録

<div id="ja-recent"><em>読み込み中...</em></div>

</div>

<script>
(function() {
  const TEAM_FULL = {
    '삼성':'삼성 라이온즈','KIA':'KIA 타이거즈','롯데':'롯데 자이언츠',
    'LG':'LG 트윈스','두산':'두산 베어스','한화':'한화 이글스',
    'SSG':'SSG 랜더스','키움':'키움 히어로즈','NC':'NC 다이노스','KT':'KT 위즈'
  };
  const TEAM_EN = {
    '삼성':'Samsung Lions','KIA':'KIA Tigers','롯데':'Lotte Giants',
    'LG':'LG Twins','두산':'Doosan Bears','한화':'Hanwha Eagles',
    'SSG':'SSG Landers','키움':'Kiwoom Heroes','NC':'NC Dinos','KT':'KT Wiz'
  };
  const TEAM_JA = {
    '삼성':'サムスン','KIA':'KIA','롯데':'ロッテ','LG':'LG','두산':'トゥサン',
    '한화':'ハンファ','SSG':'SSG','키움':'キウム','NC':'NC','KT':'KT'
  };

  function fmtDate(s) {
    if (!s) return '—';
    const [,m,d] = s.split('-');
    return `${parseInt(m)}/${parseInt(d)}`;
  }
  function pct(n, ok) {
    if (!n) return '—';
    return (ok / n * 100).toFixed(1) + '%';
  }
  function isThisWeek(dateStr) {
    const d = new Date(dateStr), now = new Date();
    const mon = new Date(now); mon.setDate(now.getDate() - now.getDay() + 1);
    mon.setHours(0,0,0,0);
    return d >= mon;
  }
  function isThisMonth(dateStr) {
    const d = new Date(dateStr), now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }

  function set(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val || '—';
  }

  function buildTodayKo(games) {
    if (!games || !games.length) return '<em>오늘 예정된 경기가 없습니다.</em>';
    return games.map(g => {
      const homeProb = g.home_win_prob;
      const awayProb = (100 - homeProb).toFixed(1);
      const fav = homeProb >= 50 ? g.home_team : g.away_team;
      const favProb = homeProb >= 50 ? homeProb : 100 - homeProb;
      return `<p>🔵 <strong>${g.away_team} @ ${g.home_team}</strong> [${g.game_time || ''}] → <strong>${fav} ${parseFloat(favProb).toFixed(1)}% 우세</strong>${g.reason ? ` <small>(${g.reason})</small>` : ''}</p>`;
    }).join('\n');
  }
  function buildTodayEn(games) {
    if (!games || !games.length) return '<em>No games scheduled today.</em>';
    return games.map(g => {
      const fav = g.home_win_prob >= 50 ? g.home_team : g.away_team;
      const favProb = g.home_win_prob >= 50 ? g.home_win_prob : 100 - g.home_win_prob;
      return `<p>🔵 <strong>${TEAM_EN[g.away_team]||g.away_team} @ ${TEAM_EN[g.home_team]||g.home_team}</strong> [${g.game_time||''}] → <strong>${TEAM_EN[fav]||fav} ${parseFloat(favProb).toFixed(1)}% favored</strong></p>`;
    }).join('\n');
  }
  function buildTodayJa(games) {
    if (!games || !games.length) return '<em>本日の試合はありません。</em>';
    return games.map(g => {
      const fav = g.home_win_prob >= 50 ? g.home_team : g.away_team;
      const favProb = g.home_win_prob >= 50 ? g.home_win_prob : 100 - g.home_win_prob;
      return `<p>🔵 <strong>${TEAM_JA[g.away_team]||g.away_team} @ ${TEAM_JA[g.home_team]||g.home_team}</strong> [${g.game_time||''}] → <strong>${TEAM_JA[fav]||fav} ${parseFloat(favProb).toFixed(1)}% 有利</strong></p>`;
    }).join('\n');
  }

  function buildRecentTable(history, teamName) {
    const rows = [...history].reverse().flatMap(day =>
      day.games.map(g => {
        const fav = g.home_win_prob >= 50 ? g.home_team : g.away_team;
        const favProb = g.home_win_prob >= 50 ? g.home_win_prob : 100 - g.home_win_prob;
        const res = g.correct === true ? '✅' : g.correct === false ? '❌' : '⏳';
        return `<tr><td>${fmtDate(day.date)}</td><td>${g.away_team}@${g.home_team}</td><td>${fav} ${parseFloat(favProb).toFixed(1)}%</td><td>${g.actual_winner||'—'}</td><td>${res}</td></tr>`;
      })
    ).slice(0, 20).join('');
    return `<table><thead><tr><th>${teamName[0]}</th><th>${teamName[1]}</th><th>${teamName[2]}</th><th>${teamName[3]}</th><th>${teamName[4]}</th></tr></thead><tbody>${rows||'<tr><td colspan="5">—</td></tr>'}</tbody></table>`;
  }

  function buildByTeamTable(history, teamName, header) {
    const stats = {};
    history.flatMap(d => d.games).forEach(g => {
      [g.home_team, g.away_team].forEach(t => { if (!stats[t]) stats[t] = {n:0,ok:0}; });
      const homePred = g.home_win_prob >= 50;
      if (g.correct !== null && g.correct !== undefined) {
        stats[g.home_team].n++; if (g.correct) stats[g.home_team].ok++;
        stats[g.away_team].n++; if (g.correct) stats[g.away_team].ok++;
      }
    });
    const order = ['삼성','KIA','롯데','LG','두산','한화','SSG','키움','NC','KT'];
    const rows = order.map(t => {
      const s = stats[t] || {n:0,ok:0};
      const name = teamName === 'en' ? (TEAM_EN[t]||t) : teamName === 'ja' ? (TEAM_JA[t]||t) : (TEAM_FULL[t]||t);
      return `<tr><td>${name}</td><td>${s.n||'—'}</td><td>${s.ok||'—'}</td><td>${s.n ? pct(s.n,s.ok) : '—'}</td></tr>`;
    }).join('');
    return `<table><thead><tr><th>${header[0]}</th><th>${header[1]}</th><th>${header[2]}</th><th>${header[3]}</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  fetch('/riyuna/baseball/data.json?t=' + Date.now())
    .then(r => r.json())
    .then(data => {
      const history = data.history || [];
      const allGames = history.flatMap(d => d.games || []);
      const judged = allGames.filter(g => g.correct !== null && g.correct !== undefined);
      const correct = judged.filter(g => g.correct === true);
      const monthJudged = judged.filter(g => isThisMonth(history.find(d => d.games.includes(g))?.date));
      const monthOk = monthJudged.filter(g => g.correct);
      const weekJudged = judged.filter(g => isThisWeek(history.find(d => d.games.includes(g))?.date));
      const weekOk = weekJudged.filter(g => g.correct);

      const updated = data.updated || '—';
      ['ko','en','ja'].forEach(lang => {
        set(`${lang}-updated`, updated);
        set(`${lang}-total-n`, judged.length || '—');
        set(`${lang}-total-ok`, correct.length || '—');
        set(`${lang}-total-pct`, pct(judged.length, correct.length));
        set(`${lang}-month-n`, monthJudged.length || '—');
        set(`${lang}-month-ok`, monthOk.length || '—');
        set(`${lang}-month-pct`, pct(monthJudged.length, monthOk.length));
        set(`${lang}-week-n`, weekJudged.length || '—');
        set(`${lang}-week-ok`, weekOk.length || '—');
        set(`${lang}-week-pct`, pct(weekJudged.length, weekOk.length));
      });

      const todayGames = data.today?.games || [];
      const el_ko = document.getElementById('ko-today');
      const el_en = document.getElementById('en-today');
      const el_ja = document.getElementById('ja-today');
      if (el_ko) el_ko.innerHTML = buildTodayKo(todayGames);
      if (el_en) el_en.innerHTML = buildTodayEn(todayGames);
      if (el_ja) el_ja.innerHTML = buildTodayJa(todayGames);

      const el_ko_r = document.getElementById('ko-recent');
      const el_en_r = document.getElementById('en-recent');
      const el_ja_r = document.getElementById('ja-recent');
      if (el_ko_r) el_ko_r.innerHTML = buildRecentTable(history, ['날짜','경기','예측','결과','적중']);
      if (el_en_r) el_en_r.innerHTML = buildRecentTable(history, ['Date','Game','Prediction','Result','Hit']);
      if (el_ja_r) el_ja_r.innerHTML = buildRecentTable(history, ['日付','試合','予想','結果','的中']);

      const el_ko_t = document.getElementById('ko-by-team');
      const el_en_t = document.getElementById('en-by-team');
      const el_ja_t = document.getElementById('ja-by-team');
      if (el_ko_t) el_ko_t.innerHTML = buildByTeamTable(history, 'ko', ['팀','예측 수','적중','적중률']);
      if (el_en_t) el_en_t.innerHTML = buildByTeamTable(history, 'en', ['Team','Predictions','Correct','Accuracy']);
      if (el_ja_t) el_ja_t.innerHTML = buildByTeamTable(history, 'ja', ['チーム','予想数','的中','的中率']);
    })
    .catch(() => {
      ['ko-today','en-today','ja-today'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<em>데이터를 불러오지 못했습니다.</em>';
      });
    });
})();
</script>
