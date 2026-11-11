// 🎬 YARR 뮤직비디오 전체 화면 (2026-11-11 · 1단계 '분위기 영상' · 추가 원가 0원)
// - 곡의 분위기 그림(스테이션 사진 풀)에 천천히 확대 · 이동(Ken Burns) + 디졸브 전환
// - 큰 가사 (곡 구조로 어림한 위치) · 곡마다 실제로 잰 LUFS 배지 (값이 없으면 숨겨요)
// - 매장 TV 화면: 시계 · 지금 나오는 곡 · QR · 화면 꺼짐 방지
// 이 파일은 'MV' 버튼을 누를 때 처음 불러와요. 닫으면 타이머 · 애니메이션 · 화면 꺼짐 방지를 모두 풀어요 (차트 · 미니 플레이어에서는 아무것도 안 돌아요)
// 가사 시간 계산은 앱 lib/data/lyric_timing.dart 와 같아요.

const STUDIO_HEADS = new Set(['verse', 'chorus', 'bridge', 'narration intro', 'narration break', 'narration outro']);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** 가사([Verse] …) + 곡 길이(초) → { sections:[{key,start,end,lines}], cues:[{t,text,sec,spoken}] } */
export function estimateCues(lyrics, duration) {
  const dur = Number.isFinite(duration) && duration >= 30 ? duration : 180;
  const blocks = [];
  for (const raw of String(lyrics || '').replace(/\r/g, '').split('\n')) {
    const l = raw.trim(); if (!l) continue;
    const m = /^\[(.+)\]$/.exec(l);
    if (m) blocks.push([m[1].trim().toLowerCase(), []]);
    else { if (!blocks.length) blocks.push(['verse', []]); blocks[blocks.length - 1][1].push(l); }
  }
  const heads = blocks.map((b) => b[0]);
  const studio = heads.length > 0 && heads.every((h) => STUDIO_HEADS.has(h)) && new Set(heads).size === heads.length;
  const seq = []; // [key, lines, weight, fixed|null]
  const introFixed = clamp(dur * 0.08, 6, 14), outroFixed = clamp(dur * 0.07, 5, 14);
  const w = (ls, narr) => (narr ? ls.length * 1.2 + 1 : ls.length + 1);
  if (studio) {
    const of = (k) => blocks.find((b) => b[0] === k)?.[1] || [];
    const verse = of('verse'), chorus = of('chorus'), bridge = of('bridge');
    const nIntro = of('narration intro'), nBreak = of('narration break'), nOutro = of('narration outro');
    const two = verse.length >= 6, half = Math.ceil(verse.length / 2);
    const add = (k, ls, narr = false) => { if (ls.length) seq.push([k, ls, w(ls, narr), null]); };
    if (nIntro.length) add('narr', nIntro, true); else seq.push(['intro', [], 0, introFixed]);
    add('verse', two ? verse.slice(0, half) : verse);
    add('narr', nBreak, true);
    add('chorus', chorus);
    if (two) { add('verse', verse.slice(half)); add('chorus', chorus); }
    add('bridge', bridge);
    if (dur >= 150) add('chorus', chorus);
    if (nOutro.length) add('narr', nOutro, true); else seq.push(['outro', [], 0, outroFixed]);
  } else {
    seq.push(['intro', [], 0, introFixed]);
    for (const [h, ls] of blocks) {
      if (!ls.length) continue;
      const k = /^(chorus|hook)/.test(h) || h.includes('후렴') ? 'chorus' : /^bridge/.test(h) || h.includes('브릿지') ? 'bridge' : /^narration/.test(h) ? 'narr' : 'verse';
      seq.push([k, ls, w(ls, k === 'narr'), null]);
    }
    seq.push(['outro', [], 0, outroFixed]);
  }
  const fixed = seq.reduce((s, x) => s + (x[3] ?? 0), 0);
  const weight = seq.reduce((s, x) => s + (x[3] == null ? x[2] : 0), 0);
  const sections = [], cues = [];
  let t = 0;
  for (const [k, ls, wt, fx] of seq) {
    const len = fx ?? (weight ? ((dur - fixed) * wt) / weight : 0);
    sections.push({ key: k, start: t, end: clamp(t + len, 0, dur), lines: ls });
    ls.forEach((text, i) => cues.push({ t: t + (len * i) / (ls.length + 0.6), text, sec: k, spoken: k === 'narr' }));
    t += len;
  }
  return { sections, cues };
}

/** 지금 위치의 줄 번호 (전주 · 마무리면 -1) */
export function cueAt(timing, pos) {
  if (!timing) return -1;
  let i = -1;
  timing.cues.forEach((c, k) => { if (c.t <= pos) i = k; });
  if (i < 0) return -1;
  const sung = timing.sections.filter((s) => s.lines.length);
  if (sung.length && pos >= sung[sung.length - 1].end) return -1;
  return i;
}

/** AI 6컷 장면 칸 (서버 MV_SLOTS 순서 · 앱 sceneSlot 과 같아요). 가사가 없으면 곡 길이를 6칸으로 */
export function sceneSlot(timing, pos, dur) {
  const secs = timing?.sections || [];
  if (!secs.some((s) => s.lines.length)) return dur > 0 ? clamp(Math.floor((pos / dur) * 6), 0, 5) : 0;
  const bridge = secs.some((s) => s.key === 'bridge');
  let v = 0, c = 0, slot = 0;
  for (const s of secs) {
    if (s.key === 'intro') slot = 0;
    else if (s.key === 'verse') slot = ++v === 1 ? 1 : 3;
    else if (s.key === 'chorus') { c++; slot = c === 1 ? 2 : c === 2 ? (bridge ? 2 : 4) : 5; }
    else if (s.key === 'bridge') slot = 4;
    else if (s.key === 'outro') slot = 5;
    if (pos < s.end) return slot;
  }
  return 5;
}

const PATHS = [
  ['-6%,-2%', '5%,2%', 1.06, 1.2], ['5%,3%', '-4%,-2%', 1.18, 1.05], ['0,5%', '0,-4%', 1.08, 1.22], ['4%,-4%', '-5%,4%', 1.2, 1.08],
];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const CSS = `
.mv{position:fixed;inset:0;z-index:9000;background:#000;color:#fff;overflow:hidden;font-family:inherit;cursor:default;user-select:none}
.mv.hide-ui{cursor:none}
.mv .lay{position:absolute;inset:-2%;background:center/cover no-repeat;opacity:0;transition:opacity 1.6s ease;will-change:transform,opacity}
.mv .lay.on{opacity:1}
.mv .fb{position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 35%,#3a2414,#0b0b0c)}
.mv .shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.6),rgba(0,0,0,.07) 25%,rgba(0,0,0,.13) 55%,rgba(0,0,0,.9));pointer-events:none}
.mv .ly{position:absolute;left:24px;right:24px;bottom:120px;text-align:center;text-shadow:0 2px 14px rgba(0,0,0,.8);pointer-events:none}
.mv.tv .ly{bottom:150px}
.mv .ly b{display:block;font-size:clamp(26px,4.2vw,52px);font-weight:900;line-height:1.3;word-break:keep-all;animation:mvIn .42s ease}
.mv .ly b.sp{font-style:italic}
.mv .ly small{display:block;margin-top:10px;font-size:clamp(14px,2vw,24px);font-weight:700;color:rgba(255,255,255,.6);line-height:1.3;word-break:keep-all}
.mv .hint{position:absolute;left:24px;right:24px;bottom:92px;text-align:center;font-size:11.5px;color:rgba(255,255,255,.7);text-shadow:0 1px 8px #000;opacity:0;transition:opacity .4s;pointer-events:none}.mv .hint.on{opacity:1}.mv.tv .hint{bottom:110px}
.mv .ly .sub{font-size:clamp(14px,1.6vw,19px);color:#e8e2da;font-weight:500;margin-top:6px}
@keyframes mvIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.mv .chip{display:inline-block;padding:3px 8px;border-radius:6px;background:rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.3);font-size:11px;font-weight:800;margin:0 6px 6px 0}
.mv .chip.o{color:#ff9a5c;border-color:rgba(255,154,92,.6)}.mv .chip.g{color:#6ee7a0;border-color:rgba(110,231,160,.6)}
.mv .ui{transition:opacity .25s}.mv.hide-ui .ui{opacity:0;pointer-events:none}
.mv .top{position:absolute;left:12px;right:12px;top:12px;display:flex;align-items:flex-start;gap:8px}
.mv .x{flex:none;width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,.3);background:rgba(0,0,0,.5);color:#fff;font-size:20px;cursor:pointer}
.mv .bar{position:absolute;left:12px;right:12px;bottom:10px;padding:8px 12px;border-radius:16px;background:rgba(17,17,17,.82);border:1px solid rgba(255,255,255,.2);display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 10px;backdrop-filter:blur(8px)}
.mv .seek{flex:1 1 100%;display:flex;align-items:center;gap:10px;font-size:12px;color:#d8d2ca}
.mv .seek .tl{flex:1;height:14px;display:flex;align-items:center;cursor:pointer}.mv .seek .tl div{flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.2);overflow:hidden}.mv .seek .tl i{display:block;height:100%;width:0;background:#ff9a5c}
.mv .bar button{border:0;background:none;color:#fff;font:inherit;font-size:14px;font-weight:700;cursor:pointer;padding:6px 8px;border-radius:10px}
.mv .bar button:hover{background:rgba(255,255,255,.08)}
.mv .bar .pp{width:48px;height:48px;border-radius:50%;background:#ff7a33;font-size:20px}
.mv .bar .o{color:#ff9a5c}
.mv .tvl{position:absolute;left:72px;top:20px}.mv .tvl .k{font-family:'DotGothic',monospace;color:#ffb46a;font-size:14px;letter-spacing:.5px}.mv .tvl p{margin:4px 0 0;font-size:12px;color:rgba(255,255,255,.8)}
.mv .tvr{position:absolute;right:24px;top:16px;text-align:right}.mv .tvr .clk{font-family:'DotGothic',monospace;font-size:clamp(32px,4vw,48px);line-height:1}.mv .tvr .live{margin-top:6px;font-size:12px;font-weight:800}.mv .tvr .live:before{content:'';display:inline-block;width:8px;height:8px;border-radius:50%;background:#ff4d3d;margin-right:6px;vertical-align:1px}
.mv .tvb{position:absolute;left:24px;right:24px;bottom:22px;display:flex;align-items:flex-end;gap:12px}
.mv .np{flex:1;min-width:0;padding:10px 14px;border-radius:12px;background:rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.2)}
.mv .np .k{font-family:'DotGothic',monospace;font-size:11px;color:#ff9a5c}.mv .np b{display:block;font-size:18px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mv .np span{font-size:12.5px;color:rgba(255,255,255,.8)}
.mv .qr{flex:none;padding:8px;border-radius:12px;background:rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.2);text-align:center;font-size:10.5px;font-weight:700}
.mv .qr .q{width:84px;height:84px;background:#fff;border-radius:4px;padding:4px;margin:0 auto 4px}.mv .qr .q svg{width:100%;height:100%;display:block}
.mv.tv .bar{bottom:auto;top:84px;left:50%;right:auto;transform:translateX(-50%)}
@media (max-width:640px){.mv .tvl{left:24px;top:64px}.mv .tvl .k{font-size:12px}.mv.tv .bar{top:118px}.mv .ly{bottom:150px}.mv.tv .ly{bottom:170px}.mv .tvr .clk{font-size:30px}.mv .qr .q{width:64px;height:64px}}
`;

let open = null; // 열린 MV (한 번에 하나)

/**
 * ctx = { track(), audio(), toggle(), next(), prev(), pics(t) → [url], station() → {name,emoji}|null,
 *         api(body), sbUrl, sbKey, link(t) → url, fav?(t) → bool, tv?: boolean, onClose?() }
 */
export function openMv(ctx) {
  if (open) { open.setTv(!!ctx.tv); return open; }
  if (!document.getElementById('mvCss')) { const st = document.createElement('style'); st.id = 'mvCss'; st.textContent = CSS; document.head.appendChild(st); }
  const root = document.createElement('div');
  root.className = 'mv'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', '뮤직비디오 전체 화면');
  root.innerHTML = `<div class="fb"></div><div class="lay" data-l="0"></div><div class="lay" data-l="1"></div><div class="shade"></div>
    <div class="ly" aria-live="polite"></div><div class="hint">가사 위치는 곡 구조로 어림해요</div><div class="tvx"></div>
    <div class="ui"><div class="top"><button class="x" data-a="close" aria-label="닫기">✕</button><div class="chips"></div></div>
    <div class="bar"><div class="seek"><span class="cur">0:00</span><div class="tl"><div><i></i></div></div><span class="dur">0:00</span></div>
    <button data-a="prev" aria-label="이전 곡">⏮</button><button class="pp" data-a="toggle" aria-label="재생 · 일시정지">▶</button><button data-a="next" aria-label="다음 곡">⏭</button>
    <span class="tvbtn"></span><button class="o" data-a="tv"></button></div></div>`;
  document.body.appendChild(root);
  const q = (s) => root.querySelector(s);
  const L = [q('[data-l="0"]'), q('[data-l="1"]')];
  let tv = !!ctx.tv, li = 0, slide = 0, pics = [], forId = null, timing = null, lyrics = null, timedFor = 0, lufs = null, lineKey = '', anim = null;
  let scenes = null, sceneAt = -1, hintT = 0;
  let hideT = 0, slideT = 0, pollT = 0, clockT = 0, wake = null, shift = 0, qrSvg = '', qrFor = '';
  const fmt = (s) => !isFinite(s) || s < 0 ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const slideLen = () => { const t = ctx.track(); const bpm = Number(t?.bpm) || 90; return clamp((60 / bpm) * 16, 6, 14) * 1000; };

  function kb(el, k, long = false) {
    const [a, b, s0, s1] = PATHS[k % PATHS.length];
    anim?.cancel?.();
    anim = el.animate([{ transform: `translate(${a}) scale(${s0})` }, { transform: `translate(${b}) scale(${s1})` }], { duration: long ? 24000 : slideLen() + 1800, easing: 'ease-in-out', fill: 'forwards' });
    if (ctx.audio().paused) anim.pause();
  }
  function show(k, url = pics[k % pics.length], long = false) {
    if (!url) { L.forEach((x) => x.classList.remove('on')); return; }
    const el = L[li = 1 - li], other = L[1 - li];
    el.style.backgroundImage = `url('${url}')`;
    kb(el, k, long);
    el.classList.add('on'); other.classList.remove('on');
    const nx = new Image(); nx.src = scenes ? (scenes[(k + 1) % 6] || pics[(k + 1) % pics.length] || '') : pics[(k + 1) % pics.length]; // 다음 그림을 미리 받아 둬요
  }
  function restartSlides() {
    clearInterval(slideT);
    show(slide = 0);
    if (pics.length > 1) slideT = setInterval(() => { if (!ctx.audio().paused && !scenes) show(++slide); }, slideLen());
  }
  async function loadTrack(t) {
    forId = t?.id ?? null; lyrics = null; timing = null; timedFor = 0; lufs = null; lineKey = ''; scenes = null; sceneAt = -1;
    pics = t ? ctx.pics(t) : [];
    restartSlides(); chips(); lyricsUi(); tvUi();
    if (!t) return;
    const id = t.id;
    ctx.api({ action: 'mv', id }).then((j) => {
      if (forId !== id) return;
      if (Number.isFinite(j?.lufs)) lufs = j.lufs;
      // 2단계 AI 6컷이 있으면 곡 구간을 따라 장면이 바뀌어요 (빈 칸은 분위기 그림)
      if (Array.isArray(j?.scenes) && j.scenes.length === 6 && j.scenes.some(Boolean)) { scenes = j.scenes; sceneAt = -1; }
      chips(); tvUi(); tick();
    }).catch(() => {});
    if (t.instrumental === false || t.instrumental == null) {
      try {
        const r = await fetch(`${ctx.sbUrl}/rest/v1/rpc/track_lyrics`, { method: 'POST', headers: { apikey: ctx.sbKey, authorization: `Bearer ${ctx.sbKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ p_track: id }) });
        const j = r.ok ? await r.json() : [];
        if (forId === id && j?.[0]?.lyrics) { lyrics = j[0].lyrics; tick(); }
      } catch { /* 가사 없이 곡 이름만 보여 줘요 */ }
    }
  }
  function chips() {
    q('.chips').innerHTML = tv ? '' : `<span class="chip o">${scenes ? '🎬 AI 6컷 MV' : '🎬 분위기 MV'}</span>${lufs != null ? `<span class="chip g" title="이 곡을 검수할 때 잰 실제 음량이에요">${lufs.toFixed(1)} LUFS</span>` : ''}`;
  }
  function sub(t) { return t ? [t.artist, t.bpm ? `${t.bpm} BPM` : '', t.genre || ''].filter(Boolean).join(' · ') : ''; }
  function lyricsUi() {
    const t = ctx.track(), el = ctx.audio();
    const at = cueAt(timing, el.currentTime || 0);
    const key = at >= 0 ? `l${at}` : `t${t?.id}`;
    if (key === lineKey) return;
    lineKey = key;
    if (at < 0) q('.ly').innerHTML = `<b>${esc(t?.title || 'YARR')}</b><div class="sub">${esc(sub(t))}</div>`;
    else { const c = timing.cues[at], n = timing.cues[at + 1]; q('.ly').innerHTML = `<b class="${c.spoken ? 'sp' : ''}">${esc(c.spoken ? `“${c.text}”` : c.text)}</b>${n ? `<small>${esc(n.text)}</small>` : ''}`; }
  }
  function tick() {
    const el = ctx.audio(), t = ctx.track();
    if ((t?.id ?? null) !== forId) { loadTrack(t); return; }
    const d = el.duration;
    if (lyrics && d > 0 && Math.abs(d - timedFor) > 1) {
      const first = !timedFor; timedFor = d; timing = estimateCues(lyrics, d); chips(); lineKey = '';
      // 가사가 처음 붙을 때 3초만 작게 (늘 떠 있으면 몰입이 깨져요)
      if (first && !tv) { q('.hint').classList.add('on'); clearTimeout(hintT); hintT = setTimeout(() => q('.hint')?.classList.remove('on'), 3000); }
    }
    if (scenes) { const k = sceneSlot(timing, el.currentTime || 0, d); if (k !== sceneAt) { sceneAt = k; show(k, scenes[k] || pics[k % (pics.length || 1)], true); } }
    lyricsUi();
    q('.cur').textContent = fmt(el.currentTime); q('.dur').textContent = fmt(d);
    q('.seek i').style.width = d ? `${(el.currentTime / d) * 100}%` : '0';
    q('.pp').textContent = el.paused ? '▶' : '❚❚';
    if (anim) el.paused ? anim.pause() : anim.play();
  }
  async function qrFor_(url) {
    if (qrFor === url) return qrSvg;
    qrFor = url; qrSvg = '';
    try {
      if (!window.qrcode) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      const g = window.qrcode(0, 'M'); g.addData(url); g.make(); qrSvg = g.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    } catch { qrSvg = ''; }
    return qrSvg;
  }
  async function tvUi() {
    const box = q('.tvx');
    if (!tv) { box.innerHTML = ''; q('.tvbtn').innerHTML = ''; return; }
    const t = ctx.track(), st = ctx.station?.(), now = new Date();
    const hh = String(now.getHours()).padStart(2, '0'), mm = String(now.getMinutes()).padStart(2, '0');
    const url = t ? ctx.link(t) : '';
    const svg = url ? await qrFor_(url) : '';
    const dx = shift * 2;
    box.innerHTML = `<div class="tvl" style="transform:translate(${dx}px,${dx}px)"><div class="k">YARR STORE BGM · 매장 디스플레이</div><p>검수 통과 편성곡 · AI로 만든 음악</p></div>
      <div class="tvr" style="transform:translate(${-dx}px,${dx}px)"><div class="clk">${hh}:${mm}</div><div class="live">LIVE${st ? ` · ${esc(st.emoji || '')} ${esc(st.name)}` : ''}</div></div>
      <div class="tvb" style="transform:translateX(${dx}px)"><div class="np"><div class="k">NOW PLAYING</div><b>${esc(t?.title || '-')}</b><span>${esc(sub(t))}${lufs != null ? ` · <span style="color:#6ee7a0">${lufs.toFixed(1)} LUFS</span>` : ''}</span></div>
      ${svg ? `<div class="qr"><div class="q" role="img" aria-label="이 곡 바로 듣기 QR">${svg}</div>QR 찍고 바로 듣기</div>` : ''}</div>`;
    q('.tvbtn').innerHTML = ctx.fav && ctx.canFav?.() !== false && t ? `<button data-a="fav">👍 매장 분위기 잘 맞음</button>` : '';
  }
  function poke() {
    root.classList.remove('hide-ui');
    clearTimeout(hideT); hideT = setTimeout(() => root.classList.add('hide-ui'), tv ? 6000 : 4000);
  }
  async function setTv(on) {
    tv = on; root.classList.toggle('tv', tv);
    q('[data-a="tv"]').textContent = tv ? '📱 일반 화면' : '📺 매장 TV 모드';
    if (tv && 'wakeLock' in navigator && !wake) wake = await navigator.wakeLock.request('screen').catch(() => null);
    if (!tv && wake) { wake.release().catch(() => {}); wake = null; }
    chips(); lineKey = ''; tvUi(); poke();
  }
  const onVis = async () => { if (tv && document.visibilityState === 'visible' && 'wakeLock' in navigator) wake = await navigator.wakeLock.request('screen').catch(() => null); };
  const onKey = (e) => { if (e.key === 'Escape' && !document.fullscreenElement) close(); else if (e.key === ' ') { e.preventDefault(); ctx.toggle(); } };
  function close() {
    clearInterval(slideT); clearInterval(pollT); clearInterval(clockT); clearTimeout(hideT); clearTimeout(hintT);
    anim?.cancel?.(); wake?.release?.().catch(() => {}); wake = null;
    document.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onVis);
    if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
    root.remove(); open = null; document.body.style.overflow = '';
    ctx.onClose?.();
  }
  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') return close();
    if (a === 'toggle') ctx.toggle();
    else if (a === 'next') ctx.next();
    else if (a === 'prev') ctx.prev();
    else if (a === 'tv') { setTv(!tv); if (tv && root.requestFullscreen && !document.fullscreenElement) root.requestFullscreen().catch(() => {}); }
    else if (a === 'fav') { const t = ctx.track(); if (t) ctx.fav(t); }
    if (e.target.closest('.tl')) { const r = e.target.closest('.tl').getBoundingClientRect(), el = ctx.audio(); if (el.duration) el.currentTime = ((e.clientX - r.left) / r.width) * el.duration; }
    poke(); setTimeout(tick, 60);
  });
  root.addEventListener('mousemove', poke);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVis);
  document.body.style.overflow = 'hidden';
  pollT = setInterval(tick, 250);
  clockT = setInterval(() => { shift = (shift + 1) % 4; tvUi(); }, 30000); // 매장 TV 번인 방지: 30초마다 글자 자리를 조금씩
  loadTrack(ctx.track());
  setTv(tv);
  if (tv && root.requestFullscreen) root.requestFullscreen().catch(() => {});
  open = { close, setTv };
  return open;
}
