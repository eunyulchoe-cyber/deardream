/* DearDream 받아쓰기 엔진
 *
 *  device-native : 안드로이드 앱. 직접 만든 DreamSpeech 플러그인(연속 듣기, 구간 누적, stop 항상 resolve)
 *  device-web    : 브라우저 Web Speech API (ko-KR, 끊기면 자동 재시작, 안드로이드 Chrome 중복 결과 보정)
 *  server        : 녹음(MediaRecorder) → 말이 쉬는 곳에서 잘라 백엔드 /api/transcribe (Workers AI Whisper)
 *                  긴 꿈 이야기에 가장 정확하고, 끊김·삐 소리 없음. 인터넷 필요.
 *
 * 공통: start(cb) / stop() → Promise<string>  (stop은 항상 정해진 시간 안에 끝난다)
 *   cb.onText({committed, partial, pending})  cb.onLevel(0~1)  cb.onError({message, fatal})  cb.onEnd(reason)
 */
(function () {
  const timeout = (p, ms, fallback) => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback()), ms))]);
  const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const nativePlugin = () => isNative() && window.Capacitor.Plugins && window.Capacitor.Plugins.DreamSpeech;
  const WebSR = () => window.SpeechRecognition || window.webkitSpeechRecognition;
  const canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  const join = (a, b) => [a, b].map((s) => (s || "").trim()).filter(Boolean).join(" ");

  /* ---------------- 안드로이드 네이티브 ---------------- */
  function NativeEngine() {
    const P = nativePlugin();
    let subs = [], committed = "", partial = "";
    return {
      kind: "device-native", label: "기기 받아쓰기",
      async start(cb) {
        committed = ""; partial = "";
        subs.push(await P.addListener("partial", (d) => { partial = d.partial || ""; committed = d.committed || committed; cb.onText({ committed, partial }); }));
        subs.push(await P.addListener("segment", (d) => { committed = d.committed || join(committed, d.text); partial = ""; cb.onText({ committed, partial }); }));
        subs.push(await P.addListener("level", (d) => cb.onLevel(Math.max(0, Math.min(1, ((d.rms ?? -2) + 2) / 12)))));
        subs.push(await P.addListener("error", (d) => { cb.onError({ message: d.message, fatal: !!d.fatal }); if (d.fatal) cb.onEnd("error"); }));
        subs.push(await P.addListener("state", (d) => { if (d.reason === "paused") cb.onEnd("paused"); }));
        try { await P.start({ language: "ko-KR" }); }
        catch (e) { this._cleanup(); throw e; }
      },
      async stop() {
        const r = await timeout(P.stop().catch(() => null), 2500, () => null);
        this._cleanup();
        return (r && typeof r.text === "string" && r.text.length >= committed.length) ? r.text : join(committed, partial);
      },
      _cleanup() { subs.forEach((s) => s && s.remove && s.remove()); subs = []; }
    };
  }

  /* ---------------- 브라우저 Web Speech ---------------- */
  function WebSpeechEngine() {
    const SR = WebSR();
    let rec = null, active = false, finals = [], interim = "", cb = null, endWaiter = null, restarts = 0, startedAt = 0;
    const text = () => ({ committed: finals.join(" ").trim(), partial: interim.trim() });
    function spawn() {
      rec = new SR();
      rec.lang = "ko-KR"; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
      let sessionFinals = [];   // 이 세션에서 확정된 것 (재시작마다 새로)
      const base = finals.slice();
      rec.onresult = (ev) => {
        // 매번 이 세션의 결과 전체로 다시 만든다 (덮어쓰기·누락 방지)
        sessionFinals = []; interim = "";
        for (let i = 0; i < ev.results.length; i++) {
          const t = (ev.results[i][0] && ev.results[i][0].transcript || "").trim();
          if (!t) continue;
          if (ev.results[i].isFinal) {
            // 안드로이드 Chrome: 확정 결과가 앞 결과를 포함해 누적되어 오는 버그 → 포함하면 교체
            const last = sessionFinals[sessionFinals.length - 1];
            if (last && t.startsWith(last)) sessionFinals[sessionFinals.length - 1] = t;
            else if (!last || !last.startsWith(t)) sessionFinals.push(t);
          } else interim = join(interim, t);
        }
        finals = base.concat(sessionFinals);
        cb.onText(text());
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") { active = false; cb.onError({ message: "마이크 권한이 필요합니다.", fatal: true }); cb.onEnd("error"); }
        else if (e.error === "language-not-supported") { active = false; cb.onError({ message: "이 브라우저는 한국어 받아쓰기를 지원하지 않습니다.", fatal: true }); cb.onEnd("error"); }
        // no-speech / aborted / network: onend에서 재시작
      };
      rec.onend = () => {
        if (interim) { finals.push(interim.trim()); interim = ""; }
        if (endWaiter) { const w = endWaiter; endWaiter = null; w(); return; }
        if (active) {
          // 브라우저가 무음 등으로 스스로 끝냄 → 계속 듣기 (너무 잦으면 중단)
          restarts = Date.now() - startedAt < 1000 ? restarts + 1 : 0;
          if (restarts > 5) { active = false; cb.onError({ message: "브라우저 음성 인식이 계속 끊깁니다. 글로 적어 주세요.", fatal: true }); cb.onEnd("error"); return; }
          setTimeout(() => { if (active) { startedAt = Date.now(); try { spawn(); } catch { active = false; cb.onEnd("error"); } } }, 150);
        }
      };
      startedAt = Date.now();
      rec.start();
    }
    return {
      kind: "device-web", label: "브라우저 받아쓰기",
      async start(callbacks) { cb = callbacks; finals = []; interim = ""; active = true; restarts = 0; spawn(); },
      async stop() {
        active = false;
        await timeout(new Promise((r) => { endWaiter = r; try { rec && rec.stop(); } catch { r(); } }), 1500, () => { try { rec && rec.abort(); } catch {} });
        if (interim) { finals.push(interim.trim()); interim = ""; }
        return text().committed;
      }
    };
  }

  /* ---------------- 서버 받아쓰기 (녹음 → Whisper) ---------------- */
  function ServerEngine() {
    const MIN_MS = () => Number(window.DD_TEST_CHUNK_MIN_MS ?? 6000);
    const MAX_MS = () => Number(window.DD_TEST_CHUNK_MAX_MS ?? 25000);
    const SILENCE_MS = 700;
    let stream, ctx, analyser, rafTimer, recorder, chunkStart = 0, lastVoice = 0, curState = { voiced: false };
    let parts = [], queue = Promise.resolve(), pending = 0, seq = 0, active = false, cb, failed = 0;
    const mime = () => ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || "";
    const committed = () => parts.filter(Boolean).join(" ").trim();
    const emit = () => cb.onText({ committed: committed(), partial: pending ? "…" : "", pending });

    function newRecorder() {
      const type = mime();
      const r = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
      const blobs = [];
      const myStart = Date.now();
      const state = { voiced: false };
      curState = state;
      r.ondataavailable = (e) => e.data && e.data.size && blobs.push(e.data);
      r.onstop = () => {
        const dur = Date.now() - myStart;
        const blob = new Blob(blobs, { type: r.mimeType || type || "audio/webm" });
        // 말소리가 없던 구간은 보내지 않는다 (비용 절약 + Whisper의 무음 환각 방지)
        if (state.voiced && blob.size > 1000) upload(blob, dur);
      };
      r.start();
      chunkStart = myStart;
      return r;
    }
    function upload(blob, dur) {
      const i = seq++; parts[i] = ""; pending++; emit();
      queue = queue.then(async () => {
        const prev = committed().slice(-200);
        for (let attempt = 0; attempt < 2; attempt++) {
          try { const out = await DDAPI.transcribe(blob, { seq: i, durationMs: dur, prompt: prev }); parts[i] = out.text || ""; break; }
          catch (e) { if (attempt === 1) { failed++; cb.onError({ message: "한 구간을 받아쓰지 못했습니다.", fatal: false }); } else await new Promise((r) => setTimeout(r, 800)); }
        }
        pending--; emit();
      });
    }
    function cut() { if (!active || !recorder) return; const old = recorder; recorder = newRecorder(); old.stop(); }
    function tick() {
      if (!analyser) return;
      const buf = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(buf);
      let sum = 0; for (const v of buf) sum += (v - 128) * (v - 128);
      const rms = Math.sqrt(sum / buf.length) / 128;  // 0~1
      const level = Math.min(1, rms * 6);
      cb.onLevel(level);
      const now = Date.now();
      if (rms > 0.02) { lastVoice = now; curState.voiced = true; }
      const len = now - chunkStart;
      if (active && ((len > MIN_MS() && now - lastVoice > SILENCE_MS && curState.voiced) || len > MAX_MS())) cut();
    }
    return {
      kind: "server", label: "서버 받아쓰기",
      async start(callbacks) {
        cb = callbacks; parts = []; seq = 0; pending = 0; failed = 0; queue = Promise.resolve();
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
        window.DDVoice._lastStream = stream;
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const src = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser(); analyser.fftSize = 1024; src.connect(analyser);
        active = true; lastVoice = Date.now();
        recorder = newRecorder();
        rafTimer = setInterval(tick, 100);
        stream.getAudioTracks()[0].addEventListener("ended", () => { if (active) { cb.onError({ message: "마이크가 끊겼습니다.", fatal: true }); cb.onEnd("error"); } });
      },
      async stop() {
        active = false;
        clearInterval(rafTimer);
        // 마이크는 즉시 놓는다
        const last = recorder; recorder = null;
        const stopped = new Promise((r) => { if (!last || last.state === "inactive") return r(); last.addEventListener("stop", () => setTimeout(r, 0), { once: true }); last.stop(); });
        await timeout(stopped, 1000, () => null);
        stream && stream.getTracks().forEach((t) => t.stop());
        try { ctx && ctx.close(); } catch {}
        analyser = null;
        cb.onText({ committed: committed(), partial: "…", pending, finishing: true });
        await timeout(queue, 30000, () => null);
        return committed();
      },
      failedCount: () => failed
    };
  }

  /* ---------------- 고르기 ---------------- */
  let health = null, healthAt = 0;
  async function serverStatus() {
    // 서버가 설정 안 됐거나 최근 연결 실패면 바로 'off' (도달 못 하는 서버를 기다리지 않음)
    if (!DDAPI.configured() || DDAPI.knownDown()) return { transcribe: "off" };
    if (health && Date.now() - healthAt < 5 * 60 * 1000) return health;
    try { health = await DDAPI.health(); healthAt = Date.now(); }
    catch { health = { transcribe: "off" }; healthAt = Date.now() - 4 * 60 * 1000; }
    return health;
  }
  function deviceEngine() { if (nativePlugin()) return NativeEngine(); if (WebSR()) return WebSpeechEngine(); return null; }
  async function pick(mode) {
    if (mode === "device") return deviceEngine() || (canRecord() ? ServerEngine() : null);
    if (mode === "server") return canRecord() && DDAPI.configured() && !DDAPI.knownDown() ? ServerEngine() : deviceEngine();
    // auto: 실제 서버 받아쓰기가 켜져 있으면 서버(긴 말에 정확), 아니면 기기
    const h = await serverStatus();
    if (h.transcribe === "live" && canRecord()) return ServerEngine();
    return deviceEngine() || (canRecord() && h.transcribe === "mock" ? ServerEngine() : null);
  }
  const anyAvailable = () => !!(nativePlugin() || WebSR() || canRecord());
  window.DDVoice = { pick, anyAvailable, serverStatus, _engines: { NativeEngine, WebSpeechEngine, ServerEngine } };
})();
