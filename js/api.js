/* 우리 백엔드(Cloudflare Worker)만 부릅니다.
 * - API_BASE가 비어 있으면 즉시 'no_backend' 오류 (네트워크 시도 없음)
 * - 모든 요청에 시간 제한. fetch 중단이 안 먹는 WebView에 대비해 별도 타이머로도 끊는다.
 * - 연결 실패가 나면 60초 동안 '서버 없음'으로 기억해서 다음 요청은 바로 실패(빠른 오프라인 전환) */
(function () {
  const T = { interpret: 15000, images: 60000, report: 8000, transcribe: 20000, health: 2500 };
  let downUntil = 0;
  const base = () => (window.DD_CONFIG.API_BASE || "").trim();
  const err = (code, msg, status) => Object.assign(new Error(msg || code), { code, status });
  const configured = () => !!base();
  const knownDown = () => Date.now() < downUntil;
  function markDown() { downUntil = Date.now() + 60000; }
  function markUp() { downUntil = 0; }

  async function request(path, { method = "POST", body, timeoutMs, force = false } = {}) {
    if (!configured()) throw err("no_backend", "서버가 설정되지 않았습니다.");
    if (!force && knownDown()) throw err("offline", "서버에 연결되지 않습니다.");
    const ctrl = new AbortController();
    let timer;
    const guard = new Promise((_, rej) => { timer = setTimeout(() => { ctrl.abort(); rej(err("timeout", "서버 응답이 없습니다.")); }, timeoutMs); });
    try {
      const res = await Promise.race([
        fetch(base() + path, {
          method,
          headers: method === "POST" ? { "Content-Type": "application/json", "X-DD-Client": "web/" + window.DD_CONFIG.APP_VERSION } : {},
          body: method === "POST" ? JSON.stringify(body) : undefined,
          signal: ctrl.signal
        }).then(async (r) => ({ r, data: await r.json().catch(() => ({})) })),
        guard
      ]);
      markUp();
      if (!res.r.ok) throw Object.assign(err(res.data.code || "http", res.data.error || "HTTP " + res.r.status, res.r.status), { retryAfter: res.r.headers.get("Retry-After") });
      return res.data;
    } catch (e) {
      if (!e.status) { markDown(); if (!e.code || e.name === "AbortError" || e.name === "TypeError") throw err(e.code === "timeout" ? "timeout" : "offline", "서버에 연결되지 않습니다."); }
      throw e;
    } finally { clearTimeout(timer); }
  }
  const toBase64 = (blob) => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(",")[1] || "");
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
  window.DDAPI = {
    configured, knownDown,
    health: (force) => request("/api/health", { method: "GET", timeoutMs: T.health, force }),
    transcribe: async (blob, meta) => request("/api/transcribe", { body: { audio: await toBase64(blob), mime: blob.type, ...meta }, timeoutMs: T.transcribe }),
    interpret: (text, opts = {}) => request("/api/interpret", { body: { text }, timeoutMs: T.interpret, force: !!opts.force }),
    images: (scenes, character) => request("/api/images", { body: { scenes, character }, timeoutMs: T.images, force: true }),
    report: (payload) => request("/api/report", { body: payload, timeoutMs: T.report, force: true })
  };
})();
