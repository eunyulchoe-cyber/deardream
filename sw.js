/* DearDream service worker
 * VERSION은 scripts/stamp-sw.mjs가 파일 해시로 자동 갱신합니다 (배포 전 `npm run stamp`).
 *  - 정적 파일(앱 껍데기): 버전별 캐시에 미리 담고 cache-first
 *  - 페이지(HTML): network-first (3초 넘으면 캐시)
 *  - API(/api/*, 백엔드 도메인): 네트워크 전용. 꿈 내용은 캐시에 남기지 않음 (POST는 SW가 손대지 않음)
 *  - 새 버전: 설치 후 대기 → 앱이 "새로고침" 안내 → SKIP_WAITING 메시지로 교체 */
const VERSION = "dd-c094b7bf14";
const STATIC_CACHE = `deardream-static-${VERSION}`;
const PAGE_CACHE = `deardream-pages-${VERSION}`;
const PRECACHE = [
  "./",
  "./index.html",
  "./privacy.html",
  "./css/app.css",
  "./js/env.js",
  "./js/config.js",
  "./js/split.js",
  "./js/db.js",
  "./js/api.js",
  "./js/voice.js",
  "./js/ads.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: "reload" })))));
  // 첫 설치(제어 중인 페이지 없음)면 바로 활성화, 업데이트면 사용자가 누를 때까지 대기
  if (!self.registration.active) self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([STATIC_CACHE, PAGE_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("deardream-") && !keep.has(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // 백엔드·외부: 브라우저 기본 동작(네트워크)
  if (url.pathname.includes("/api/")) return;                // 같은 도메인 API도 네트워크 전용
  if (req.mode === "navigate") { event.respondWith(networkFirst(req)); return; }
  event.respondWith(cacheFirst(req));
});

async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === "basic") {
    const c = await caches.open(STATIC_CACHE);
    c.put(req, res.clone());
  }
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000))
    ]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req)) || (await caches.match("./index.html", { ignoreSearch: true })) ||
      new Response("오프라인입니다.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
