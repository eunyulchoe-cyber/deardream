/* 서버 주소는 js/env.js 의 API_BASE. 앱에는 어떤 API 키도 두지 않습니다. */
(function () {
  const h = location.hostname;
  const local = h === "localhost" || h === "127.0.0.1";
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  // 개발용 덮어쓰기: ?api=http://127.0.0.1:8797 (localhost에서만, 기억됨)
  let override = null;
  if (local) {
    const q = new URLSearchParams(location.search).get("api");
    if (q) localStorage.setItem("dd.api", q);
    override = localStorage.getItem("dd.api");
    if (override === "none") override = null, window.DD_FORCE_NO_BACKEND = true;   // 테스트: 서버 없음 흉내
  }
  window.DD_CONFIG = {
    // 로컬: wrangler dev(8787). 안드로이드 에뮬레이터에서 PC의 로컬 서버는 10.0.2.2.
    // 폰 빌드에는 에뮬레이터 주소(10.0.2.2)를 넣지 않는다. 비어 있으면 서버 없이 기기 안에서만 동작.
    API_BASE: window.DD_FORCE_NO_BACKEND ? "" : (override || (!isNative && local ? `http://${h}:8787` : (window.DD_ENV && window.DD_ENV.API_BASE) || "")).replace(/\/+$/, ""),
    // AdMob — 지금은 Google 공식 테스트 ID. 출시 직전에 내 광고 단위 ID로 교체.
    ADMOB: {
      testing: true,
      banner: "ca-app-pub-3940256099942544/6300978111",
      rewarded: "ca-app-pub-3940256099942544/5224354917"
    },
    APP_VERSION: "0.1.5"
  };
})();
