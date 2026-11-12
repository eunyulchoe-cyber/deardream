/* 광고 어댑터.
 * - 안드로이드(Capacitor): @capacitor-community/admob (배너 + 보상형). 지금은 Google 테스트 ID.
 * - 웹/PWA: 자리표시 배너 + 3초 테스트 광고 스텁. (웹 수익화는 나중에 AdSense/AdFit로 교체)
 * showRewarded()는 보상을 받았으면 true, 닫았으면 false를 돌려줍니다. */
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

  async function showRewarded() {
    if (native() && plugin()) {
      const AdMob = plugin();
      return new Promise(async (resolve) => {
        let rewarded = false;
        const subs = [];
        const done = () => { subs.forEach((s) => s && s.remove && s.remove()); resolve(rewarded); };
        try {
          subs.push(await AdMob.addListener("onRewardedVideoAdReward", () => { rewarded = true; }));
          subs.push(await AdMob.addListener("onRewardedVideoAdDismissed", done));
          subs.push(await AdMob.addListener("onRewardedVideoAdFailedToShow", done));
          await AdMob.prepareRewardVideoAd({ adId: cfg().rewarded, isTesting: cfg().testing });
          const item = await AdMob.showRewardVideoAd();
          if (item) rewarded = true;
          setTimeout(done, 300);
        } catch (e) { console.warn("보상형 광고 실패", e); done(); }
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
      const end = (ok) => { if (finished) return; finished = true; clearInterval(timer); close.onclick = null; dlg.close(); resolve(ok); };
      close.onclick = () => end(false);
      dlg.showModal();
      const timer = setInterval(() => { n -= 1; count.textContent = n; if (n <= 0) end(true); }, 1000);
      if (n <= 0) end(true);
    });
  }

  window.DDAds = { init, showRewarded, isNative: native };
})();
