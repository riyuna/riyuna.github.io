'use strict';
// SharedArrayBuffer를 쓰려면 페이지가 cross-origin isolated 상태여야 하는데, GitHub Pages는 응답 헤더를 바꿀 수 없다.
// 이 서비스 워커가 /randle/ 아래 응답에 COOP/COEP 헤더를 붙여 준다(사이트의 다른 페이지에는 영향 없음).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;
  e.respondWith(
    fetch(r).then(res => {
      if (res.status === 0) return res;
      const headers = new Headers(res.headers);
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Resource-Policy', 'same-origin');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }),
  );
});
