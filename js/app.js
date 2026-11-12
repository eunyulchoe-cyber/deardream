/* DearDream 웹 앱 */
(function () {
  const $ = (s) => document.querySelector(s);
  const VIEWS = ["wake", "draft", "loading", "result", "archive"];
  let current = null; // 지금 보고 있는 기록

  function show(name) {
    VIEWS.forEach((v) => $("#view-" + v).classList.toggle("on", v === name));
    window.scrollTo(0, 0);
    document.body.dataset.view = name;
  }
  function toast(msg, ms = 2600) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function fmt(iso, withTime = true) {
    const d = new Date(iso);
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    const s = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} (${days[d.getDay()]})`;
    return withTime ? `${s} ${pad(d.getHours())}:${pad(d.getMinutes())}` : s;
  }
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- 음성 ----------
   * 상태: idle → starting → recording → stopping → idle
   * 멈추기는 어느 상태에서든 즉시 화면을 바꾸고, 엔진 stop()은 정해진 시간 안에 반드시 끝난다 (voice.js). */
  const MAX_REC_MS = 10 * 60 * 1000;
  let vstate = "idle", engine = null, recStart = 0, timerId = null, stopAfterStart = false, live = { committed: "", partial: "" };
  function setupVoice() {
    const sel = $("#stt-mode");
    sel.value = localStorage.getItem("dd.sttMode") || "auto";
    sel.onchange = () => localStorage.setItem("dd.sttMode", sel.value);
    if (!DDVoice.anyAvailable()) {
      $("#rec").disabled = true;
      $("#rec-label").textContent = "음성 미지원";
      $("#rec-hint").textContent = "이 환경에서는 음성 받아쓰기를 쓸 수 없습니다. 글로 적어 주세요.";
      return;
    }
    $("#rec").addEventListener("click", () => {
      if (vstate === "idle") startRecording();
      else if (vstate === "starting") { stopAfterStart = true; setVoiceUI("stopping"); }
      else if (vstate === "recording") stopRecording();
      // stopping: 무시 (곧 끝남)
    });
  }
  const mmss = (ms) => { const t = Math.floor(ms / 1000); return pad(Math.floor(t / 60)) + ":" + pad(t % 60); };
  function setVoiceUI(st) {
    vstate = st;
    const rec = $("#rec"), panel = $("#rec-panel");
    rec.classList.toggle("on", st === "recording" || st === "starting");
    rec.classList.toggle("busy", st === "stopping");
    rec.setAttribute("aria-pressed", String(st === "recording"));
    $("#rec-label").textContent = { idle: "말하기", starting: "멈추기", recording: "멈추기", stopping: "정리 중…" }[st];
    $("#rec-timer").hidden = st === "idle";
    panel.hidden = st === "idle";
    panel.classList.toggle("done", st === "stopping");
    $("#rec-state").textContent = { starting: "마이크 여는 중", recording: "듣는 중", stopping: "받아쓰기 마무리 중", idle: "" }[st];
    $("#rec-hint").textContent = st === "idle" ? "버튼을 누르고 꿈을 이야기하세요. 다시 누르면 멈춥니다." : st === "stopping" ? "잠시만요. 받아쓴 글을 고칠 수 있게 넘겨 드립니다." : "생각나는 대로 천천히. 멈추기를 누르면 바로 끝납니다.";
    $("#stt-mode").disabled = st !== "idle";
    $("#to-draft").disabled = st !== "idle";
  }
  function renderLive() {
    $("#rec-committed").textContent = live.committed;
    $("#rec-partial").textContent = live.partial || (live.committed ? "" : "…");
    const box = $("#rec-live"); box.scrollTop = box.scrollHeight;
  }
  async function startRecording() {
    stopAfterStart = false;
    live = { committed: "", partial: "" };
    renderLive();
    setVoiceUI("starting");
    try {
      engine = await DDVoice.pick($("#stt-mode").value);
      if (!engine) throw Object.assign(new Error("음성 받아쓰기를 쓸 수 없습니다."), { userMsg: true });
      $("#rec-engine").textContent = engine.label;
      await engine.start({
        onText: (t) => { live = { committed: t.committed || "", partial: t.partial || "" }; renderLive(); },
        onLevel: (v) => { $("#rec-level").style.width = Math.round(v * 100) + "%"; },
        onError: (e) => toast(e.message),
        onEnd: () => { if (vstate === "recording") stopRecording(); }
      });
    } catch (e) {
      engine = null;
      setVoiceUI("idle");
      const name = e && (e.name || e.code || "");
      toast(/NotAllowed|permission/i.test(name + (e && e.message)) ? "마이크 권한이 필요합니다. 설정에서 허용해 주세요." : (e && e.message) || "녹음을 시작하지 못했습니다.");
      return;
    }
    recStart = Date.now();
    clearInterval(timerId);
    timerId = setInterval(() => {
      const ms = Date.now() - recStart;
      $("#rec-timer").textContent = mmss(ms);
      if (ms >= MAX_REC_MS && vstate === "recording") { toast("10분이 지나 자동으로 멈췄습니다."); stopRecording(); }
    }, 250);
    setVoiceUI("recording");
    if (stopAfterStart) stopRecording();
  }
  async function stopRecording() {
    if (vstate !== "recording" && vstate !== "starting") return;
    clearInterval(timerId);
    setVoiceUI("stopping");   // 화면은 바로 바뀐다
    $("#rec-level").style.width = "0%";
    let text = "";
    try { text = engine ? await engine.stop() : ""; } catch { text = ""; }
    text = (text || live.committed || "").trim() || [live.committed, live.partial].join(" ").replace(/…/g, "").trim();
    engine = null;
    setVoiceUI("idle");
    if (!text) { toast("받아쓴 말이 없습니다. 다시 말하거나 글로 적어 주세요."); return; }
    const prev = $("#draft-note").value.trim();
    $("#draft-note").value = prev ? prev + " " + text : text;
    updateCount();
    show("draft");
    toast("받아쓴 글입니다. 틀린 곳을 고친 뒤 남기기를 누르세요.", 3500);
  }

  /* ---------- 적기 ---------- */
  function updateCount() { $("#draft-count").textContent = $("#draft-note").value.length; }

  /* 서버 없이 기기에서 만드는 간단 읽기: 원문 장면을 그대로 비춰 줄 뿐, AI인 척하지 않는다 */
  function offlineCompose(raw) {
    const parts = DDSplit.splitScenes(raw, 3);
    const titles = parts.length === 1 ? ["한 장면"] : parts.length === 2 ? ["처음", "끝"] : ["처음", "가운데", "끝"];
    const scenes = parts.map((body, i) => ({ title: titles[i], body }));
    const last = parts[parts.length - 1] || raw;
    return {
      scenes,
      reading: {
        title: "간단 읽기",
        line: `${parts.length}개의 장면으로 남은 꿈`,
        scene: last.length > 80 ? last.slice(0, 80) + "…" : last,
        body: "서버에 연결되지 않아 이 기기에서 장면만 순서대로 나눴습니다. AI 읽기가 아닙니다. 연결되면 ‘AI로 다시 읽기’로 꿈의 흐름을 비춰 보는 글을 받을 수 있습니다.",
        keep: "이 꿈에서 지우고 싶지 않은 한 단어는 무엇인가."
      }
    };
  }
  function offlineReason(e) {
    if (!e) return "서버에 연결되지 않아";
    if (e.code === "no_backend") return "아직 서버가 연결되지 않은 버전이라";
    if (e.status === 429) return "요청이 많아 잠시 서버를 쓸 수 없어";
    if (e.code === "timeout") return "서버 응답이 늦어";
    return "서버에 연결되지 않아";
  }

  /* 로딩 화면은 절대 멈춰 있지 않는다: 5초 뒤 '기기에서 바로 보기', 요청 시간 제한(15초) 뒤 자동 전환 */
  let loadingCancel = null;
  function startLoading() {
    show("loading");
    $("#loading-slow").hidden = true; $("#loading-offline").hidden = true;
    let cancelled = false; let resolveCancel;
    const cancelP = new Promise((r) => (resolveCancel = r));
    const slowT = setTimeout(() => { $("#loading-slow").hidden = false; $("#loading-offline").hidden = false; }, 5000);
    loadingCancel = () => { if (!cancelled) { cancelled = true; resolveCancel(); } };
    return { cancelP, done: () => { clearTimeout(slowT); loadingCancel = null; } };
  }
  async function interpretOrOffline(raw, force) {
    const L = startLoading();
    let out = null, error = null, wd;
    try {
      out = await Promise.race([
        DDAPI.interpret(raw, { force }),
        L.cancelP.then(() => { throw Object.assign(new Error("cancel"), { code: "cancel" }); }),
        new Promise((_, rej) => { wd = setTimeout(() => rej(Object.assign(new Error("watchdog"), { code: "timeout" })), 18000); }) // 최후의 안전장치
      ]);
    } catch (e) { error = e; }
    finally { L.done(); clearTimeout(wd); }
    return { out, error };
  }

  async function submit() {
    const raw = $("#draft-note").value.trim();
    const errEl = $("#draft-error");
    errEl.hidden = true;
    if (raw.length < 4) { errEl.textContent = "조금만 더 적어 주세요."; errEl.hidden = false; return; }
    const entry = { id: uid(), createdAt: new Date().toISOString(), raw, scenes: [], reading: null, images: null, mode: null, pending: false };
    const { out, error } = await interpretOrOffline(raw, false);
    if (out) Object.assign(entry, { scenes: out.scenes, reading: out.reading, mode: out.mode, model: out.model, character: out.character || "" });
    else Object.assign(entry, offlineCompose(raw), { mode: "offline", pending: true, error: `${offlineReason(error)} 기기에서 장면만 나눴습니다.` });
    try { await DDDB.put(entry); } catch { toast("기기에 저장하지 못했습니다."); }
    $("#draft-note").value = ""; updateCount();
    renderResult(entry);
  }

  /* ---------- 결과 ---------- */
  function renderResult(e) {
    current = e;
    $("#result-date").textContent = fmt(e.createdAt);
    const offline = e.pending || e.mode === "offline";
    const pill = $("#result-mode");
    pill.hidden = e.mode !== "mock" && e.mode !== "fallback" && !offline;
    pill.textContent = offline ? "오프라인 · 간단 읽기" : e.mode === "fallback" ? "간단 읽기" : "모의 응답";
    pill.classList.toggle("offline", offline);
    // 예전(0.1.1) 대기 기록은 읽기가 없을 수 있다
    const r = e.reading || (offline ? offlineCompose(e.raw).reading : null);
    $("#r-title").textContent = r ? r.title : "";
    $("#r-line").textContent = r ? r.line : "";
    $("#r-scene").textContent = r ? r.scene : "";
    $("#r-body").textContent = r ? r.body : "";
    $("#r-keep").textContent = r ? r.keep : "";
    $("#r-disclaimer").textContent = offline ? "기기에서 원문을 나눈 것입니다. 점이나 예언이 아닙니다." : "점이나 예언이 아닙니다. AI가 쓴 글이라 틀릴 수 있습니다.";
    $("#offline-note").hidden = !offline;
    $("#offline-msg").textContent = (e.error || "서버에 연결되지 않아 기기에서 장면만 나눴습니다.") + " 기록은 저장되었고, 연결되면 AI로 다시 읽을 수 있습니다.";
    $("#reread").hidden = !DDAPI.configured();
    const ol = $("#scenes");
    ol.innerHTML = "";
    e.scenes.forEach((s, i) => {
      const li = document.createElement("li");
      li.className = "scene";
      const img = e.images && e.images[i];
      li.innerHTML = `${img ? `<img src="${esc(img)}" alt="장면 ${i + 1} 그림" loading="lazy" />` : ""}<p class="scene-t">${esc(s.title || "장면 " + (i + 1))}</p><p>${esc(s.body)}</p>`;
      ol.appendChild(li);
    });
    $("#unlock-box").hidden = !!e.images || offline;
    $("#img-note").hidden = !offline;
    $("#unlock-error").hidden = true;
    $("#character").value = localStorage.getItem("dd.character") || "";
    $("#report").hidden = offline || !e.reading;
    show("result");
  }

  async function retryPending(e) {
    const { out, error } = await interpretOrOffline(e.raw, true);
    if (out) {
      Object.assign(e, { scenes: out.scenes, reading: out.reading, mode: out.mode, model: out.model, character: out.character || "", pending: false, error: null });
      try { await DDDB.put(e); } catch {}
      toast("AI 읽기를 받았습니다.");
    } else {
      e.error = `${offlineReason(error)} 아직 AI로 읽지 못했습니다.`;
      toast("아직 서버에 연결되지 않습니다. 기기 읽기를 그대로 보여 드립니다.");
    }
    renderResult(e);
  }

  async function unlockImages() {
    const btn = $("#unlock"); const err = $("#unlock-error");
    err.hidden = true;
    if (!DDAPI.configured()) { err.textContent = "그림은 서버 연결이 필요합니다."; err.hidden = false; return; }
    const character = $("#character").value.trim();
    localStorage.setItem("dd.character", character);
    btn.disabled = true;
    try {
      const ok = await DDAds.showRewarded();
      if (!ok) { toast("광고를 끝까지 보면 그림이 열립니다."); return; }
      btn.textContent = "그리는 중…";
      const prompts = current.scenes.map((s) => ({ title: s.title, body: s.body, image_prompt: s.image_prompt || "" }));
      // 반복 인물을 비워 두면 AI가 원문에서 뽑은 겉모습 설명(영어)을 써서 3장이 같은 모습이 되게
      const out = await DDAPI.images(prompts, character || current.character || "");
      current.images = out.images;
      current.imageMode = out.mode;
      await DDDB.put(current);
      renderResult(current);
    } catch (e) {
      err.textContent = e.status === 429 ? "오늘은 그림 요청이 많습니다. 잠시 후 다시." : (e.code === "offline" || e.code === "timeout") ? "서버에 연결되지 않아 그림을 만들지 못했습니다. 다시 시도해 주세요." : "그림을 만들지 못했습니다. 다시 시도해 주세요.";
      err.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = "광고 보고 그림 3장 열기";
    }
  }

  /* ---------- 신고 ---------- */
  function openReport() {
    const dlg = $("#report-dialog");
    $("#report-form").reset();
    dlg.showModal();
  }
  async function onReportClose() {
    const dlg = $("#report-dialog");
    if (dlg.returnValue !== "send" || !current) return;
    const f = new FormData($("#report-form"));
    const payload = {
      entryId: current.id, reason: f.get("reason"), note: (f.get("note") || "").slice(0, 500),
      model: current.model || null, mode: current.mode || null,
      content: f.get("include") ? { reading: current.reading, scenes: current.scenes.map((s) => s.title) } : null
    };
    if (!DDAPI.configured()) { toast("서버가 연결되지 않은 버전이라 신고를 보낼 수 없습니다."); return; }
    try { await DDAPI.report(payload); toast("신고가 접수되었습니다. 고맙습니다."); current.reported = true; await DDDB.put(current); }
    catch { toast("신고를 보내지 못했습니다. 연결을 확인해 주세요."); }
  }

  /* ---------- 보관함 ---------- */
  async function renderArchive() {
    const list = await DDDB.all();
    const ul = $("#archive-list"); ul.innerHTML = "";
    $("#archive-empty").hidden = list.length > 0;
    let lastDay = "";
    list.forEach((e) => {
      const day = fmt(e.createdAt, false);
      if (day !== lastDay) { const h = document.createElement("li"); h.className = "day"; h.textContent = day; ul.appendChild(h); lastDay = day; }
      const li = document.createElement("li");
      li.className = "item";
      const title = (e.pending ? "[오프라인] " : "") + (e.reading ? e.reading.title : "간단 읽기");
      li.innerHTML = `<button type="button" class="item-open"><span class="item-t">${esc(title)}</span><span class="item-s">${esc(e.raw.slice(0, 60))}${e.raw.length > 60 ? "…" : ""}</span></button><button type="button" class="item-del" aria-label="삭제">×</button>`;
      li.querySelector(".item-open").onclick = () => renderResult(e);
      li.querySelector(".item-del").onclick = async () => { if (confirm("이 기록을 지울까요?")) { await DDDB.remove(e.id); renderArchive(); } };
      ul.appendChild(li);
    });
    show("archive");
  }

  /* ---------- 서비스 워커 업데이트 ---------- */
  function setupSW() {
    if (!("serviceWorker" in navigator) || DDAds.isNative()) return;
    navigator.serviceWorker.register("./sw.js").then((reg) => {
      const prompt = (w) => {
        const t = $("#toast");
        t.innerHTML = '새 버전이 있습니다. <button type="button" class="linkbtn" id="sw-reload">새로고침</button>';
        t.hidden = false;
        $("#sw-reload").onclick = () => w.postMessage({ type: "SKIP_WAITING" });
      };
      if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w && w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) prompt(w); });
      });
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    }).catch((e) => console.warn("SW 등록 실패", e));
    // 첫 설치(clients.claim)에는 새로고침하지 않고, 업데이트로 교체될 때만 새로고침
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  }

  /* ---------- 연결 ---------- */
  function bind() {
    $("#date-line").textContent = fmt(new Date().toISOString(), false);
    $("#home").onclick = () => { if (vstate === "idle") show("wake"); };
    $("#to-draft").onclick = () => { show("draft"); $("#draft-note").focus(); };
    $("#to-archive").onclick = renderArchive;
    $("#result-archive").onclick = renderArchive;
    $("#archive-back").onclick = () => show("wake");
    $("#draft-back").onclick = () => show("wake");
    $("#draft-more").onclick = () => { show("wake"); if (vstate === "idle" && !$("#rec").disabled) startRecording(); };
    $("#draft-note").addEventListener("input", updateCount);
    $("#go").onclick = submit;
    $("#new-dream").onclick = () => show("wake");
    $("#unlock").onclick = unlockImages;
    $("#reread").onclick = () => current && retryPending(current);
    $("#loading-offline").onclick = () => loadingCancel && loadingCancel();
    $("#report").onclick = openReport;
    $("#report-dialog").addEventListener("close", onReportClose);
    $("#clear-all").onclick = async () => { if (confirm("이 기기의 모든 꿈 기록을 지울까요? 되돌릴 수 없습니다.")) { await DDDB.clear(); toast("모두 지웠습니다."); show("wake"); } };
    setupVoice();
  }

  bind();
  DDAds.init();
  setupSW();
  window.DDApp = { show, renderArchive, voiceState: () => vstate };
})();
