/* DearDream 한국어 장면 나누기 (키 없는 로컬/모의 모드용).
 * 1) 문장부호·줄바꿈으로 자르고
 * 2) 구두점 없는 말(음성 받아쓰기)은 문장 끝 어미로 자르고
 * 3) 그래도 3개보다 적으면 연결 어미(-는데, -다가, -길래 …)에서 자른다.
 * 4) 순서를 지키며 글자 수가 고르게 최대 3묶음으로 나눈다. 반복·잘림 없음. */
(function (root) {
  const END_WORD = /(?:[었았였했렸쳤졌봤왔갔됐섰났웠줬겼켰냈랐녔뒀썼꿨셨])(?:어|다|지|네|요|음|거든)$|(?:습니다|합니다|입니다|어요|아요|해요|예요|에요|이야|거야|는다|한다|었음|였음|더라|더라고|잖아)$/;
  const LINK_WORD = /(?:는데|은데|던데|다가|니까|길래|더니|면서|자마자|고서|는데도|지만|아서|어서|해서|았고|었고|였고|했고)$/;
  const PUNCT_SPLIT = /(?<=[.!?。…])\s+|\n+/;

  function clean(t) { return String(t || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim(); }

  function splitByWords(unit, test) {
    const words = unit.split(" ").filter(Boolean);
    const out = []; let cur = [];
    words.forEach((w, i) => {
      cur.push(w);
      const bare = w.replace(/[,，"'”’)\]]+$/, "");
      const isLast = i === words.length - 1;
      if (!isLast && (test(bare) || (test === isLink && /[,，]$/.test(w)))) { out.push(cur.join(" ")); cur = []; }
    });
    if (cur.length) out.push(cur.join(" "));
    return out;
  }
  function isEnd(w) { return END_WORD.test(w); }
  function isLink(w) { return LINK_WORD.test(w); }

  function units(text) {
    const t = clean(text);
    if (!t) return [];
    let u = t.split(PUNCT_SPLIT).map((s) => s.trim()).filter(Boolean);
    u = u.flatMap((s) => splitByWords(s, isEnd));
    if (u.length < 3) u = u.flatMap((s) => splitByWords(s, isLink));
    return u.map((s) => s.trim()).filter(Boolean);
  }

  /* 순서를 지키는 k분할: 가장 긴 묶음의 글자 수를 최소화 */
  function partition(items, k) {
    const n = items.length;
    if (n <= k) return items.map((x) => [x]);
    const len = items.map((s) => s.length);
    const pre = [0]; len.forEach((l) => pre.push(pre[pre.length - 1] + l));
    const cost = (a, b) => pre[b] - pre[a];
    const best = Array.from({ length: k + 1 }, () => Array(n + 1).fill(Infinity));
    const cut = Array.from({ length: k + 1 }, () => Array(n + 1).fill(0));
    best[0][0] = 0;
    for (let g = 1; g <= k; g++)
      for (let i = g; i <= n; i++)
        for (let j = g - 1; j < i; j++) {
          const v = Math.max(best[g - 1][j], cost(j, i));
          if (v < best[g][i]) { best[g][i] = v; cut[g][i] = j; }
        }
    const groups = []; let i = n;
    for (let g = k; g >= 1; g--) { const j = cut[g][i]; groups.unshift(items.slice(j, i)); i = j; }
    return groups;
  }

  function splitScenes(text, k = 3) {
    const u = units(text);
    if (!u.length) return [];
    return partition(u, Math.min(k, u.length)).map((g) => g.join(" "));
  }

  const api = { splitScenes, units, partition };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.DDSplit = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
