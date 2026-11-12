/* 광고 어댑터.
 * - 안드로이드(Capacitor): @capacitor-community/admob (배너 + 보상형). 지금은 Google 테스트 ID.
 * - 웹/PWA: 자리표시 배너 + 3초 테스트 광고 스텁. (웹 수익화는 나중에 AdSense/AdFit로 교체)
 * showRewarded()는 "rewarded" | "dismissed" | "unavailable" 를 돌려줍니다. */
(function () {
  const cfg = () => window.DD_CONFIG.ADMOB;
  const native = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const plugin = () => window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob;

  async function init() {
    if (native() && plugin()) {
      try {
        const AdMob = plugin();
        await AdMob.initialize({ initializeForTesting: cfg().testing });
        await AdMob.showBanner({ adId: cfg().banner, adSize: "ADAPTIVE_BANNER", position: "BOTTOM_CENTER", margin: 0, isTesting: cfg().testing });
        document.body.classList.add("native-ads");
        document.getElementById("ad-banner").hidden = true; // 네이티브 배너가 자리를 차지
      } catch (e) { console.warn("AdMob init 실패", e); }
    }
  }

  /* 결과: "rewarded"(끝까지 봄) | "dismissed"(중간에 닫음) | "unavailable"(광고를 못 불러옴/못 띄움) */
  async function showRewarded() {
    if (native() && plugin()) {
      const AdMob = plugin();
      return new Promise(async (resolve) => {
        let rewarded = false, failed = false, finished = false, shown = false;
        const subs = [];
        const done = () => {
          if (finished) return; finished = true; clearTimeout(loadTimer);
          subs.forEach((s) => s && s.remove && s.remove());
          resolve(rewarded ? "rewarded" : failed ? "unavailable" : "dismissed");
        };
        // 광고가 15초 안에 안 뜨면 '못 불러옴'으로 처리 (그림을 막지 않음)
        const loadTimer = setTimeout(() => { if (!shown) { failed = true; done(); } }, 15000);
        try {
          subs.push(await AdMob.addListener("onRewardedVideoAdReward", () => { rewarded = true; }));
          subs.push(await AdMob.addListener("onRewardedVideoAdShowed", () => { shown = true; clearTimeout(loadTimer); }));
          subs.push(await AdMob.addListener("onRewardedVideoAdDismissed", done));
          subs.push(await AdMob.addListener("onRewardedVideoAdFailedToShow", () => { failed = true; done(); }));
          subs.push(await AdMob.addListener("onRewardedVideoAdFailedToLoad", () => { failed = true; done(); }));
          await AdMob.prepareRewardVideoAd({ adId: cfg().rewarded, isTesting: cfg().testing });
          const item = await AdMob.showRewardVideoAd(); // 보상 시점에 끝남 (광고 화면은 아직 떠 있을 수 있음)
          if (item) { rewarded = true; done(); }
        } catch (e) { console.warn("보상형 광고 실패", e && e.message); if (!rewarded && !shown) failed = true; done(); }
      });
    }
    // 웹 스텁
    return new Promise((resolve) => {
      const dlg = document.getElementById("ad-dialog");
      const count = document.getElementById("ad-count");
      const close = document.getElementById("ad-close");
      let n = Number(window.DD_TEST_AD_SECONDS ?? 3);
      count.textContent = n;
      let finished = false;
      const end = (ok) => { if (finished) return; finished = true; clearInterval(timer); close.onclick = null; dlg.close(); resolve(ok ? "rewarded" : "dismissed"); };
      close.onclick = () => end(false);
      dlg.showModal();
      const timer = setInterval(() => { n -= 1; count.textContent = n; if (n <= 0) end(true); }, 1000);
      if (n <= 0) end(true);
    });
  }

  window.DDAds = { init, showRewarded, isNative: native };
})();
