(function () {
  'use strict';

  var lang = localStorage.getItem('site-lang') || 'ko';
  var theme = localStorage.getItem('site-theme') || 'dark';

  var navLabels = {
    '/cv/':           { ko: 'CV',    en: 'CV',            ja: 'CV' },
    '/publications/': { ko: '논문',  en: 'Publications',  ja: '論文' },
    '/talks/':        { ko: '발표',  en: 'Talks',         ja: '講演' },
    '/blog/':         { ko: '블로그', en: 'Blog',         ja: 'ブログ' },
  };

  var authorBio = {
    ko: 'KAIST 수리과학과 석박통합과정. 확률론을 연구합니다.',
    en: 'MS/PhD student at KAIST Mathematical Sciences. Interested in probability theory.',
    ja: 'KAIST 数理科学科 修士・博士一貫課程。確率論を研究しています。',
  };

  var authorLocation = {
    ko: '대전, 대한민국',
    en: 'Daejeon, South Korea',
    ja: '大田, 韓国',
  };

  function applyLang(l) {
    lang = l;
    localStorage.setItem('site-lang', l);

    document.querySelectorAll('.lang-block').forEach(function (el) {
      el.style.display = el.dataset.lang === l ? 'block' : 'none';
    });

    document.querySelectorAll('.visible-links a, .hidden-links a').forEach(function (link) {
      var href = link.getAttribute('href');
      if (navLabels[href] && navLabels[href][l]) {
        link.textContent = navLabels[href][l];
      }
    });

    var bioEl = document.querySelector('.author__bio');
    if (bioEl) bioEl.textContent = authorBio[l];

    document.querySelectorAll('.author__urls li').forEach(function (li) {
      if (li.querySelector('.fa-map-marker-alt, .fa-map-marker')) {
        var spans = li.querySelectorAll('span');
        spans.forEach(function (s) {
          if (s.textContent.trim() && !s.querySelector('i')) {
            s.textContent = authorLocation[l];
          }
        });
      }
    });

    document.querySelectorAll('.lang-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.lang === l);
    });
  }

  function applyTheme(t) {
    theme = t;
    localStorage.setItem('site-theme', t);
    if (t === 'light') {
      document.body.classList.add('light-mode');
    } else {
      document.body.classList.remove('light-mode');
    }
    var btn = document.querySelector('.theme-toggle-btn');
    if (btn) btn.textContent = t === 'dark' ? '☀' : '◑';
  }

  function injectControls() {
    var nav = document.querySelector('.greedy-nav');
    if (!nav) return;

    var wrap = document.createElement('div');
    wrap.className = 'site-controls';
    wrap.innerHTML =
      '<div class="lang-switcher">' +
        '<button class="lang-btn" data-lang="ko">한국어</button>' +
        '<button class="lang-btn" data-lang="en">EN</button>' +
        '<button class="lang-btn" data-lang="ja">JA</button>' +
      '</div>' +
      '<button class="theme-toggle-btn" title="Toggle theme">☀</button>';

    nav.appendChild(wrap);

    wrap.querySelector('.lang-switcher').addEventListener('click', function (e) {
      var btn = e.target.closest('.lang-btn');
      if (btn) applyLang(btn.dataset.lang);
    });

    wrap.querySelector('.theme-toggle-btn').addEventListener('click', function () {
      applyTheme(theme === 'dark' ? 'light' : 'dark');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    injectControls();
    applyLang(lang);
    applyTheme(theme);
  });
})();
