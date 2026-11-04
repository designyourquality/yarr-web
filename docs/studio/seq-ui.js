// 🎛 웹 스텝 시퀀서 (앱 compose_panel.dart 와 같은 기능 · 2026-11-03)
//   LCD · PLAY · 마스터 VU · 조 · 코드 4마디 + 스마트 코드 패드 · ARP · 트랙 · 피아노 롤 / 드럼 머신
//   · 사운드 노브 · 5트랙 믹서(+VU) · MIDI 내보내기(스케치 데이터 안내) · 네온 가이드
// 데이터 · 합성은 seq-core.js (앱과 같은 계산) · 합성은 seq-worker.js 에서
import {
  ComposeDraft, ChordSlot, chordBank, chordQualities, chordQualityNames, composeKeys, composeBars, composeBeats, composeRes, composeSteps, drumSteps,
  seqTracks, trackNames, leadVoices, drumLanes, drumNames, noteName, isBlack, vuHop, chordLabel, spellRoot, noteInstruments, noteInsColors,
} from './seq-core.js?v=20261113';
import { autoFill, autoParts, autoPartNames, autoStyleName, restoreFrom } from './seq-auto.js?v=20261113';

const AMBER = '#FF8C00';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const GUIDE_KEY = 'yarr_web_seq_guide_v1';

/**
 * @param {HTMLElement} root
 * @param {{ draft: ComposeDraft, bpm: () => number, vocal: () => boolean, onChange?: () => void, onClose?: () => void,
 *           toast?: (m: string) => void, beforePlay?: () => void }} o
 */
export function mountSequencer(root, o) {
  const d = o.draft;
  const toast = o.toast || ((m) => console.log(m));
  const changed = () => { o.onChange?.(); };
  // 🎲 자동 찍기 (2026-11-05 · seq-auto.js): 잠근 줄 · 되돌리기 한 번
  const A = { locked: new Set(), undo: null, msg: '' };
  const S = { track: 'lead', bar: 0, mixer: false, oct: { lead: 4, piano: 4, synth: 4, bass: 2 }, grid: 2, page: 0, levels: null, playing: false, busy: false,
    // ✏️ 찍기 / ▭ 고르기 (2026-11-05) · 고른 음 (지금 트랙의 SeqNote)
    mode: 'draw', sel: new Set() };
  // 마디 복사 · 붙여넣기 (seq-core copyBar / pasteBar)
  const C = { clip: null, from: -1, msg: '' };
  const audio = new Audio();
  audio.preload = 'auto';
  let audioUrl = null;
  let worker = null, reqId = 0;

  root.classList.add('seq');
  root.innerHTML = `
    <div class="seq-head">
      <span class="seq-ico">🎹</span><b class="seq-title">STEP SEQUENCER</b>
      <button class="seq-key" data-act="guide" title="가이드" data-g="help">?</button>
      <button class="seq-key" data-act="example">예시</button>
      <button class="seq-key" data-act="clear">트랙 지우기</button>
      ${o.onClose ? '<button class="seq-x" data-act="close" title="직접 찍기 끄기">✕</button>' : ''}
    </div>
    <div class="seq-auto" id="sqAuto"></div>
    <div class="seq-lcdrow" data-g="lcd">
      <div class="lcd"><div class="lcd-1" id="sqL1"></div><div class="lcd-2" id="sqL2"></div></div>
      <button class="transport" data-act="play" id="sqPlay"><span class="tp-ic">▶</span><span class="tp-tx">PLAY</span></button>
    </div>
    <div class="seq-meter" data-g="meter"><span class="led-lbl">MASTER</span><canvas class="vu h" id="sqVuM"></canvas></div>

    <div class="sq-eng">조 · KEY</div>
    <div class="sq-segs" data-g="key"><div class="sq-seg" id="sqKey1"></div><div class="sq-seg" id="sqKey2"></div></div>

    <div class="seq-row"><div class="sq-eng">스마트 코드 뱅크 · 마디를 고르고 패드를 누르세요</div><button class="seq-key" data-act="palette">고급 코드</button></div>
    <div class="sq-bars" id="sqBars" data-g="bars"></div>
    <div class="sq-clip" id="sqClip" data-g="clip"></div>
    <div class="pads" id="sqPads" data-g="pads"></div>
    <div class="seq-row arp" data-g="arp">
      <span class="sq-eng">ARP</span>
      <label class="sw"><input type="checkbox" id="sqArp"><i></i></label>
      <div class="sq-seg" id="sqArpMode"></div>
    </div>

    <div class="sq-eng" style="margin-top:20px">트랙</div>
    <div class="sq-seg" id="sqTracks" data-g="tracks"></div>
    <div class="sq-seg" id="sqVoice" style="margin-top:10px"></div>
    <div class="sq-brush" id="sqBrush" data-g="brush"></div>
    <div class="seq-row oct" id="sqOctRow">
      <span class="sq-eng">옥타브</span><span style="flex:1"></span>
      <button class="oct-key" data-act="octDown">▼</button><div class="lcd sm" id="sqOct"></div><button class="oct-key" data-act="octUp">▲</button>
    </div>
    <div class="seq-row sq-gridrow" id="sqGridRow" style="margin-top:8px;flex-wrap:wrap;row-gap:8px">
      <span class="sq-eng" style="flex:none">격자</span><div class="sq-seg" id="sqGrid" style="flex:1 1 150px;max-width:240px"></div>
      <div class="sq-pagenav" id="sqPageNav" style="display:flex;align-items:center;gap:6px;margin-left:auto"><button class="oct-key" data-act="pagePrev" id="sqPrev" aria-label="앞 마디">◀</button><div class="lcd sm" id="sqPage"></div><button class="oct-key" data-act="pageNext" id="sqNext" aria-label="다음 마디">▶</button></div>
    </div>
    <div class="seq-row sq-tools" id="sqTools" data-g="tools"></div>
    <div class="editor" data-g="roll"><canvas id="sqRoll" tabindex="0" aria-label="피아노 롤"></canvas><div class="drums" id="sqDrums"></div></div>
    <p class="hint" id="sqHint"></p>

    <div class="sq-eng" style="margin-top:18px">사운드 디자인</div>
    <div class="knobs" id="sqKnobs"></div>

    <button class="seq-fold" data-act="mixer" data-g="mixer"><span class="sq-eng">5-TRACK 미니 믹서</span><span class="fold-ic">⌄</span></button>
    <div class="mixer hidden" id="sqMixer"></div>

    <div class="seq-row" style="margin-top:16px"><div class="sq-eng">내보내기 · 내가 찍은 스케치</div><button class="seq-midi" data-act="midi" data-g="midi">⬇ MIDI (.mid)</button></div>
    <p class="hint" id="sqFoot"></p>
  `;
  const $ = (id) => root.querySelector('#' + id);

  // ---------- 그리기 ----------
  function lcd() {
    $('sqL1').textContent = `RECIPE: ${o.bpm()} BPM · KEY ${d.key} · ${d.slots.map((c) => chordLabel(c, d.key)).join(' ')}`;
    const step = curStep(1);
    $('sqL2').textContent = `${trackNames[S.track]} · NOTES ${d.noteCount} · SWING ${Math.round(d.swing * 100)}%${S.playing && step >= 0 ? ` · ▶ ${step % composeBeats + 1}/${composeBeats}` : ''}`;
  }
  function segHtml(labels, sel, attr) {
    return labels.map((l, i) => `<button class="${i === sel ? 'on' : ''}" ${attr}="${i}">${esc(l)}</button>`).join('');
  }
  function keys() {
    const i = composeKeys.indexOf(d.key);
    $('sqKey1').innerHTML = segHtml(composeKeys.slice(0, 6), i < 6 ? i : -1, 'data-key');
    $('sqKey2').innerHTML = segHtml(composeKeys.slice(6), i >= 6 ? i - 6 : -1, 'data-key6');
  }
  function bars() {
    const s = curStep(1);
    $('sqBars').innerHTML = d.slots.map((c, b) => `<button class="sq-bar${b === S.bar ? ' sq-sel' : ''}${s >= 0 && Math.floor((s % composeBeats) / 4) === b ? ' sq-play' : ''}" data-bar="${b}"><span>${esc(chordLabel(c, d.key))}</span></button>`).join('');
  }
  /** 마디 복사 · 붙여넣기 줄 (고른 마디 S.bar 에) */
  function clipUi() {
    const has = !!C.clip, drum = S.track === 'drums';
    $('sqClip').innerHTML = `<button class="seq-key" data-act="barCopy" title="${S.bar + 1}마디 코드 + 음을 복사해요 (Ctrl/⌘+C)">📋 ${S.bar + 1}마디 복사</button>`
      + `<button class="seq-key" data-act="barPaste" ${has ? '' : 'disabled'} title="${S.bar + 1}마디에 코드 + 네 트랙 음을 붙여요 (Ctrl/⌘+V)">붙여넣기 · 전체</button>`
      + `<button class="seq-key" data-act="barPasteTrack" ${has && !drum ? '' : 'disabled'} title="${S.bar + 1}마디에 ${esc(trackNames[S.track])} 음만 붙여요 (코드는 그대로)">붙여넣기 · 이 트랙만</button>`
      + `<span class="sq-clip-note">${C.msg ? esc(C.msg) : has ? `${C.from + 1}마디 복사됨` : '마디를 고르고 복사해 보세요'}</span>`;
  }
  /** 고른 음 (트랙에서 사라진 음은 빼요 · 붙여넣기 · 되돌리기 뒤에도 안전하게) */
  function selNotes() {
    const list = d.tracks[S.track];
    if (!list) { S.sel.clear(); return []; }
    for (const n of S.sel) if (!list.includes(n)) S.sel.delete(n);
    return [...S.sel];
  }
  function clearSel() { S.sel.clear(); }
  /** ✏️ 찍기 / ▭ 고르기 · 고른 음 도구 */
  function toolsUi() {
    const drum = S.track === 'drums', sel = S.mode === 'select', n = selNotes().length, dis = n ? '' : 'disabled';
    $('sqTools').classList.toggle('hidden', drum);
    if (drum) return;
    $('sqTools').innerHTML = `<div class="sq-seg sq-mode"><button class="${sel ? '' : 'on'}" data-mode="draw">✏️ 찍기</button><button class="${sel ? 'on' : ''}" data-mode="select">▭ 고르기</button></div>`
      + (sel ? `<div class="sq-selbar"><span class="sq-selnum">${n ? `${n}개 고름` : '고른 음 없음'}</span>`
        + `<button class="seq-key" data-act="selNone" ${dis}>선택 해제</button><button class="seq-key" data-act="selDel" ${dis}>고른 음 지우기</button>`
        + `<span class="sq-nudge"><button class="oct-key" data-act="nudgeL" ${dis} aria-label="한 칸 앞으로">◀</button><button class="oct-key" data-act="nudgeR" ${dis} aria-label="한 칸 뒤로">▶</button>`
        + `<button class="oct-key" data-act="nudgeU" ${dis} aria-label="반음 위로">▲</button><button class="oct-key" data-act="nudgeD" ${dis} aria-label="반음 아래로">▼</button></span></div>` : '');
  }
  /** 고른 음 옮기기 (틱 · 반음) → 실제로 옮긴 양 */
  function moveSel(ds, dm) {
    const sel = selNotes(); if (!sel.length || (!ds && !dm)) return [0, 0];
    const r = d.moveNotes(S.track, sel, ds, dm);
    if (r[0] || r[1]) changed();
    return r;
  }
  function deleteSel() {
    const sel = selNotes(); if (!sel.length) return;
    const list = d.tracks[S.track];
    for (const n of sel) list.splice(list.indexOf(n), 1);
    clearSel(); changed(); lcd(); playBtn(); toolsUi(); drawRoll();
  }
  function barCopy() {
    C.clip = d.copyBar(S.bar); C.from = S.bar; C.msg = '';
    clipUi();
  }
  function barPaste(onlyTrack) {
    if (!C.clip) { toast('먼저 마디를 복사해 주세요'); return; }
    if (onlyTrack && S.track === 'drums') return;
    d.pasteBar(S.bar, C.clip, { only: onlyTrack ? S.track : null });
    C.msg = `${C.from + 1}마디 → ${S.bar + 1}마디${onlyTrack ? ` (${trackNames[S.track]}만)` : ''} 붙여넣었어요`;
    selNotes(); changed(); all();
  }
  function pads() {
    const bank = chordBank(d.key);
    const cur = d.slots[S.bar].name;
    $('sqPads').innerHTML = bank.map((c, i) => `<button class="pad${c.name === cur ? ' on' : ''}" data-pad="${i}">${esc(chordLabel(c, d.key))}</button>`).join('');
  }
  function arp() {
    $('sqArp').checked = d.arp;
    $('sqArpMode').innerHTML = segHtml(['Up', 'Down', 'Random'], ['up', 'down', 'random'].indexOf(d.arpMode), 'data-arp');
    $('sqArpMode').classList.toggle('dim', !d.arp);
  }
  function tracksUi() {
    $('sqTracks').innerHTML = segHtml(seqTracks.map((t) => trackNames[t]), seqTracks.indexOf(S.track), 'data-track'); autoUi();
    const lead = S.track === 'lead';
    $('sqVoice').classList.toggle('hidden', !lead);
    if (lead) $('sqVoice').innerHTML = segHtml(Object.values(leadVoices), Object.keys(leadVoices).indexOf(d.leadVoice), 'data-voice');
    // 음표 악기 붓: 고른 악기로 새 음표를 찍고, 다른 악기 음표를 누르면 그 악기로 칠해요
    $('sqBrush').classList.toggle('hidden', !lead);
    if (lead) {
      const cur = d.brush && d.brush !== d.leadVoice ? d.brush : null;
      $('sqBrush').innerHTML = `<span class="sq-eng">음표 악기</span><div class="brush-chips"><button class="bchip${cur ? '' : ' on'}" data-brush="">기본 (${esc(leadVoices[d.leadVoice])})</button>${
        Object.entries(noteInstruments).filter(([k]) => k !== d.leadVoice).map(([k, label]) => `<button class="bchip${cur === k ? ' on' : ''}" data-brush="${k}" style="--c:${noteInsColors[k]}">${esc(label)}</button>`).join('')}</div>`;
    }
    const drum = S.track === 'drums';
    $('sqOctRow').classList.toggle('hidden', drum);
    $('sqGridRow').classList.toggle('hidden', drum);
    if (!drum) $('sqOct').textContent = `C${S.oct[S.track]} – C${S.oct[S.track] + 1}`;
    $('sqRoll').classList.toggle('hidden', drum);
    $('sqDrums').classList.toggle('hidden', !drum);
    $('sqHint').textContent = drum
      ? '한 마디 16칸을 4마디 내내 반복해요 · 스윙 노브로 뒷박을 사람처럼 살짝 밀어요 · 칸을 위아래로 끌면 세기'
      : S.track === 'lead' && d.brush && d.brush !== d.leadVoice
        ? `지금 붓: ${noteInstruments[d.brush]} · 빈칸을 누르면 이 악기로 찍히고, 다른 악기 음을 누르면 이 악기로 바뀌어요 · 같은 악기 음을 누르면 지워져요`
        : S.mode === 'select'
          ? '빈 곳을 끌면 네모로 골라요 · 음을 누르면 고르기/빼기 (Shift+클릭은 더하기) · 고른 음을 끌면 함께 옮겨요 · 키보드 ←→↑↓ 옮기기 · Delete 지우기 · Esc 해제'
          : `칸을 누르면 음 (격자 ${GRID_LABELS[S.grid]} 한 칸 길이) · 음 오른쪽 손잡이를 끌면 길이 (마디를 넘어 이어져요) · 음을 위아래로 끌거나 아래 세기 막대를 끌면 세기 · 멜로디는 '음표 악기'로 음마다 다른 악기를 넣을 수 있어요`;
    toolsUi(); clipUi();
  }
  function foot() {
    $('sqFoot').textContent = o.vocal()
      ? '찍은 코드를 따라 노래하고, 멜로디는 전주 · 간주에서 들려요. 미리 듣기는 이 브라우저에서 만든 연습용 소리예요.'
      : '찍은 멜로디 · 코드를 따라 새로 연주해요. 미리 듣기는 이 브라우저에서 만든 연습용 소리라 실제 곡과 소리가 달라요.';
  }
  function playBtn() {
    const b = $('sqPlay');
    b.classList.toggle('on', S.playing);
    b.disabled = S.busy || d.noteCount === 0;
    b.querySelector('.tp-ic').textContent = S.busy ? '…' : S.playing ? '■' : '▶';
    b.querySelector('.tp-tx').textContent = S.playing ? 'STOP' : 'PLAY';
  }
  function autoUi() {
    const t = S.track, tn = trackNames[t], lk = A.locked.has(t), lc = A.locked.has('chords');
    const locked = [...A.locked].map((x) => autoPartNames[x]).join(' · ');
    $('sqAuto').innerHTML = `<button class="seq-key" data-act="autoAll" title="장르에 맞는 코드 · 베이스 · 반주 · 드럼 · 멜로디를 채워요 (잠근 줄은 그대로)">🎲 전체 채우기</button>`
      + `<button class="seq-key" data-act="autoTrack">🎲 ${tn}만 다시</button>`
      + `<button class="seq-key${lk ? ' on' : ''}" data-act="lockTrack">${lk ? '🔓' : '🔒'} ${tn} ${lk ? '잠금 풀기' : '잠그기'}</button>`
      + `<button class="seq-key${lc ? ' on' : ''}" data-act="lockChords">${lc ? '🔓 코드 잠금 풀기' : '🔒 코드 잠그기'}</button>`
      + (A.undo ? '<button class="seq-key" data-act="autoUndo">↶ 되돌리기</button>' : '')
      + (A.msg || locked ? `<span class="seq-auto-note">${A.msg}${A.msg && locked ? ' · ' : ''}${locked ? `잠근 줄: ${locked}` : ''}</span>` : '');
  }
  function auto(whole) {
    const genre = o.genre?.() || 'pop';
    if (!whole && A.locked.has(S.track)) { toast('잠근 트랙이에요 · 🔒 를 풀고 다시 눌러 주세요'); return; }
    A.undo = d.toJson(); // 되돌리기 한 번
    clearSel();
    autoFill(d, { genre, seed: Math.floor(Math.random() * 0x7fffffff), parts: whole ? autoParts : [S.track], locked: A.locked });
    A.msg = whole ? `🎲 ${autoStyleName(genre)} 느낌으로 채웠어요 · 마음에 안 드는 음은 눌러서 고쳐 보세요` : `🎲 ${trackNames[S.track]} 트랙을 다시 찍었어요`;
    changed(); return all();
  }
  function all() { autoUi(); lcd(); keys(); bars(); pads(); arp(); tracksUi(); drawEditor(); knobsUi(); if (S.mixer) mixerUi(); foot(); playBtn(); }

  // ---------- 재생 위치 ----------
  // 소수 단위 재생 위치 (틱 기준 · 한 박 = composeRes 틱 · 0 ~ composeSteps)
  function curPos() {
    if (!S.playing) return -1;
    const beat = 60 / Math.min(180, Math.max(60, o.bpm()));
    return (audio.currentTime / beat * composeRes) % composeSteps;
  }
  function curStep(unitsPerBeat) {
    if (!S.playing) return -1;
    const beat = 60 / Math.min(180, Math.max(60, o.bpm()));
    return Math.floor(audio.currentTime / (beat / unitsPerBeat));
  }

  // ---------- 피아노 롤 (canvas · 틱 단위 · 앱 compose_panel.dart _PianoRoll 과 같은 동작) ----------
  //   저장은 1/16 틱(composeRes = 한 박 4칸) · 화면 격자는 1/4 · 1/8 · 1/16 중에서 골라요 (기본 1/16)
  //   칸이 너무 작아지면(좁은 화면) 한 번에 보이는 마디를 4 → 2 → 1 로 줄이고 ◀ ▶ 로 넘겨요
  const ROWS = 13, LABEL = 34, ROWH = 24, RULER = 16, MIN_CELL = 12;
  // 세기 막대 줄 (피아노 롤 아래 · 2026-11-05)
  const LANE_GAP = 6, LANE_H = 46, LANE_PAD = 4;
  const ROLL_B = RULER + ROWS * ROWH, LANE_T = ROLL_B + LANE_GAP, LANE_B = LANE_T + LANE_H;
  const BAR_TICKS = 4 * composeRes;
  const GRIDS = [composeRes, composeRes / 2, 1]; // 1/4 · 1/8 · 1/16 (격자 한 칸 = 틱 몇 개)
  const GRID_LABELS = ['1/4', '1/8', '1/16'];
  const roll = $('sqRoll');
  let drag = null; // { kind: 'len'|'vel'|'grip'|'move'|'rect'|'lane', note, hnote, s0, midi0, x0, y0, v0, moved, ... }
  function rollGeom() {
    const w = roll.clientWidth || roll.parentElement.clientWidth || 320;
    const grid = GRIDS[S.grid];
    const perBar = BAR_TICKS / grid;
    // 한 화면에 보일 마디 수: 칸 너비가 MIN_CELL 이상이 되는 가장 큰 값 (4 · 2 · 1)
    let bars = 1;
    for (const b of [composeBars, 2, 1]) { if ((w - LABEL) / (b * perBar) >= MIN_CELL) { bars = b; break; } }
    const span = bars * BAR_TICKS;
    const from = Math.min(Math.floor(S.page / bars) * bars, composeBars - bars) * BAR_TICKS;
    const cells = span / grid, cellW = (w - LABEL) / cells, tickW = cellW / grid;
    return { w, grid, bars, span, from, cells, cellW, tickW };
  }
  const tx = (geo, t) => LABEL + (t - geo.from) * geo.tickW;
  function low() { return 12 * (S.oct[S.track] + 1); }
  function drawEditor() { if (S.track === 'drums') drawDrums(); else { drawRoll(); pageUi(); } }
  function pageUi() {
    const geo = rollGeom();
    const first = geo.from / BAR_TICKS;
    $('sqGrid').innerHTML = segHtml(GRID_LABELS, S.grid, 'data-grid');
    $('sqPage').textContent = geo.bars === composeBars ? `1–${composeBars}마디` : geo.bars === 1 ? `${first + 1}마디` : `${first + 1}–${first + geo.bars}마디`;
    $('sqPrev').disabled = first <= 0;
    $('sqNext').disabled = first + geo.bars >= composeBars;
    $('sqPageNav').classList.toggle('hidden', geo.bars === composeBars);
  }
  /** 음 색 (멜로디는 음표마다 고른 악기 색) */
  const insColor = (n) => (S.track === 'lead' && n.ins && n.ins !== d.leadVoice ? noteInsColors[n.ins] : null);
  const noteFill = (n) => { const a = 0.45 + 0.55 * n.vel / 127; return insColor(n) || `rgba(255,${Math.round(120 + 60 * (1 - a))},0,${a})`; };
  /** 세기 막대: 이 화면에서 시작하는 (보이는 높이의) 음마다 하나 · 같은 자리에서 시작하는 음은 나란히 */
  function laneBars(geo) {
    const lo = low(), hi = lo + ROWS - 1, end = geo.from + geo.span;
    const xs = d.tracks[S.track].filter((n) => n.midi >= lo && n.midi <= hi && n.step >= geo.from && n.step < end);
    const steps = [...new Set(xs.map((n) => n.step))].sort((a, b) => a - b);
    const out = [];
    steps.forEach((s, i) => {
      const next = i + 1 < steps.length ? steps[i + 1] : end;
      const col = Math.max(3, Math.min(geo.cellW, (next - s) * geo.tickW) - 3);
      const group = xs.filter((n) => n.step === s).sort((a, b) => b.midi - a.midi);
      const bw = Math.max(2, Math.min(12, (col - (group.length - 1)) / group.length));
      group.forEach((n, k) => out.push({ n, x: tx(geo, s) + 1.5 + k * (bw + 1), w: bw }));
    });
    return out;
  }
  const laneY = (vel) => LANE_B - LANE_PAD - (LANE_H - LANE_PAD * 2) * vel / 127;
  function drawRoll() {
    const geo = rollGeom();
    const { w, grid, from, span, cellW, tickW } = geo;
    const H = LANE_B, dpr = window.devicePixelRatio || 1;
    if (roll.width !== Math.round(w * dpr) || roll.height !== Math.round(H * dpr)) { roll.width = Math.round(w * dpr); roll.height = Math.round(H * dpr); roll.style.height = H + 'px'; }
    const g = roll.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, H);
    const lo = low(), hi = lo + ROWS - 1;
    const pos = curPos(); // 재생 위치 (틱 · 소수)
    const ptick = pos >= 0 ? Math.floor(pos) : -1;
    const sel = new Set(selNotes());
    // 네모로 고르는 중: 네모에 걸린 음도 미리 밝게
    if (drag?.kind === 'rect') for (const n of rectNotes(geo, drag.rect)) sel.add(n);
    // 눈금자: 마디 번호 · 박 번호
    g.fillStyle = '#0B0C0F'; g.fillRect(0, 0, w, RULER);
    g.font = '700 9.5px ui-monospace,Menlo,monospace'; g.textBaseline = 'middle';
    for (let t = from; t < from + span; t += composeRes) {
      const x = tx(geo, t), bar = t % BAR_TICKS === 0;
      g.fillStyle = bar ? '#FFB067' : '#6A665F';
      const b = Math.floor(t / BAR_TICKS) + 1, bt = (t % BAR_TICKS) / composeRes + 1;
      if (bar || cellW * (composeRes / grid) >= 18) g.fillText(bar ? String(b) : `${b}.${bt}`, x + 3, RULER / 2 + 0.5);
    }
    // 줄 바탕 + 이름표 (검은 건반 줄은 더 어둡게)
    for (let r = 0; r < ROWS; r++) {
      const midi = hi - r, y = RULER + r * ROWH;
      g.fillStyle = isBlack(midi) ? '#0B0C0F' : '#13151A';
      g.fillRect(LABEL, y, w - LABEL, ROWH);
      g.fillStyle = isBlack(midi) ? '#1A1B20' : '#2A2C33';
      g.fillRect(0, y + 1, LABEL - 3, ROWH - 2);
      g.fillStyle = midi % 12 === 0 ? '#FFB067' : '#8A857D';
      g.font = '600 10px ui-monospace,Menlo,monospace';
      if (!isBlack(midi)) g.fillText(noteName(midi), 4, y + ROWH / 2);
    }
    // 빈 칸 (격자 한 칸마다 · 마디마다 바탕을 번갈아 · 재생 중인 칸은 밝게)
    const gap = cellW > 12 ? 1 : 0.5;
    for (let t = from; t < from + span; t += grid) {
      const x = tx(geo, t), alt = Math.floor(t / BAR_TICKS) % 2 === 1;
      const playing = ptick >= t && ptick < t + grid;
      g.fillStyle = playing ? 'rgba(255,140,0,.16)' : alt ? 'rgba(255,255,255,.035)' : 'rgba(255,255,255,.055)';
      for (let r = 0; r < ROWS; r++) g.fillRect(x + gap, RULER + r * ROWH + 2, cellW - gap * 2, ROWH - 4);
    }
    // 세기 막대 줄 바탕
    g.fillStyle = '#0B0C0F'; g.fillRect(0, LANE_T, w, LANE_H);
    g.fillStyle = '#2A2C33'; g.fillRect(0, LANE_T + 1, LABEL - 3, LANE_H - 2);
    g.fillStyle = '#8A857D'; g.font = '700 10px system-ui,sans-serif'; g.fillText('세기', 4, LANE_T + LANE_H / 2);
    g.fillStyle = 'rgba(255,255,255,.05)';
    for (const v of [32, 64, 96, 127]) g.fillRect(LABEL, Math.round(laneY(v)) - 0.5, w - LABEL, 1);
    // 격자선: 1/16 (가늘게) · 박 (중간) · 마디 (앰버 · 굵게) · 세기 줄까지 이어서
    const vlines = (y0, y1, light) => {
      for (let t = from; t <= from + span; t++) {
        const bar = t % BAR_TICKS === 0, beat = t % composeRes === 0;
        if (!bar && !beat && (light || t % grid !== 0)) continue;
        const x = tx(geo, t);
        if (bar) { g.fillStyle = 'rgba(255,140,0,.6)'; g.fillRect(x - 0.75, y0, 1.5, y1 - y0); }
        else if (beat) { g.fillStyle = light ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.2)'; g.fillRect(x - 0.5, Math.max(y0, RULER), 1, y1 - Math.max(y0, RULER)); }
        else { g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(x - 0.5, Math.max(y0, RULER), 1, y1 - Math.max(y0, RULER)); }
      }
    };
    vlines(0, ROLL_B, false); vlines(LANE_T, LANE_B, true);
    const visible = (n) => n.midi >= lo && n.midi <= hi && n.end > from && n.step < from + span;
    const noteRect = (n) => [tx(geo, n.step) + 1.5, RULER + (hi - n.midi) * ROWH + 3, n.len * tickW - 3, ROWH - 6];
    g.save(); g.beginPath(); g.rect(LABEL, 0, w - LABEL, ROLL_B); g.clip();
    const pageEnd = from + span;
    for (const n of d.tracks[S.track]) {
      if (!visible(n)) continue;
      const [x, y, ww, hh] = noteRect(n);
      const a = 0.45 + 0.55 * n.vel / 127;
      const ic = insColor(n); // 음표마다 고른 악기 색
      const on = sel.has(n);
      g.shadowColor = on ? 'rgba(255,255,255,.9)' : ic || 'rgba(255,140,0,.55)'; g.shadowBlur = on ? 10 : 8 * a;
      if (ic) { g.globalAlpha = a; g.fillStyle = ic; } else g.fillStyle = noteFill(n);
      roundRect(g, x, y, Math.max(2, ww), hh, Math.min(4, ww / 2)); g.fill(); g.globalAlpha = 1;
      g.shadowBlur = 0;
      if (on) {
        g.fillStyle = 'rgba(255,255,255,.28)'; roundRect(g, x, y, Math.max(2, ww), hh, Math.min(4, ww / 2)); g.fill();
        g.strokeStyle = '#FFFFFF'; g.lineWidth = 2; roundRect(g, x + 0.5, y + 0.5, Math.max(1, ww - 1), hh - 1, Math.min(4, ww / 2)); g.stroke();
      }
      // 세기 막대 (작게) · 이음줄 · 길이 손잡이
      g.fillStyle = 'rgba(26,14,2,.55)';
      g.fillRect(x + 2, y + hh - 4, Math.max(1, (ww - 4) * n.vel / 127), 2);
      // 이음줄: 마디 선을 넘는 음은 그 자리에 작은 홈 + 붙임줄 (한 음이 이어진다는 표시)
      for (let b = (Math.floor(n.step / BAR_TICKS) + 1) * BAR_TICKS; b < n.end; b += BAR_TICKS) {
        if (b <= from || b >= pageEnd) continue;
        const bx = tx(geo, b);
        g.fillStyle = isBlack(n.midi) ? '#0B0C0F' : '#13151A';
        g.beginPath(); g.moveTo(bx - 4, y - 0.5); g.lineTo(bx + 4, y - 0.5); g.lineTo(bx, y + 4); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(bx - 4, y + hh + 0.5); g.lineTo(bx + 4, y + hh + 0.5); g.lineTo(bx, y + hh - 4); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(26,14,2,.85)'; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(bx - 7, y + hh / 2 - 2); g.quadraticCurveTo(bx, y + hh / 2 + 4, bx + 7, y + hh / 2 - 2); g.stroke();
      }
      g.font = '800 11px system-ui,sans-serif'; g.fillStyle = 'rgba(26,14,2,.9)';
      if (n.step < from) g.fillText('←', LABEL + 2, y + hh / 2 + 0.5); // 앞 화면에서 이어져 온 음
      if (n.end > pageEnd) g.fillText('→', w - 13, y + hh / 2 + 0.5); // 다음 화면으로 이어지는 음
      else if (ww >= 12) {
        // 길이 손잡이 (오른쪽 끝 · 끌면 길이)
        const gx = x + ww - 6;
        g.fillStyle = 'rgba(255,255,255,.42)'; roundRect(g, gx, y + 2, 4.5, hh - 4, 2); g.fill();
        g.fillStyle = 'rgba(26,14,2,.7)'; g.fillRect(gx + 1, y + hh / 2 - 3.5, 1, 7); g.fillRect(gx + 2.8, y + hh / 2 - 3.5, 1, 7);
      } else { g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(x + ww - 1.5, y + 2, 1.5, hh - 4); }
    }
    // 플레이헤드 · 재생 위치를 얇은 선이 실시간으로 지나가요
    if (pos >= from && pos < from + span) {
      const x = tx(geo, pos);
      const grad = g.createLinearGradient(x - 14, 0, x, 0);
      grad.addColorStop(0, 'rgba(255,140,0,0)'); grad.addColorStop(1, 'rgba(255,140,0,.18)');
      g.fillStyle = grad; g.fillRect(x - 14, RULER, 14, ROLL_B - RULER);
      g.shadowColor = 'rgba(255,170,60,.95)'; g.shadowBlur = 10;
      g.fillStyle = '#FFC27A'; g.fillRect(x - 0.75, 0, 1.5, ROLL_B);
      g.shadowBlur = 0;
      g.beginPath(); g.moveTo(x - 5, 0); g.lineTo(x + 5, 0); g.lineTo(x, 6); g.closePath(); g.fillStyle = '#FFB067'; g.fill();
      // 선이 지나가는 음은 잠깐 밝게
      for (const n of d.tracks[S.track]) {
        if (!visible(n) || pos < n.step || pos > n.end) continue;
        const [x2, y2, ww, hh] = noteRect(n);
        g.shadowColor = 'rgba(255,200,120,.9)'; g.shadowBlur = 14;
        g.strokeStyle = 'rgba(255,230,190,.9)'; g.lineWidth = 1.5;
        roundRect(g, x2, y2, Math.max(2, ww), hh, Math.min(4, ww / 2)); g.stroke();
        g.shadowBlur = 0;
      }
    }
    // 네모로 고르기
    if (drag?.kind === 'rect') {
      const [x0, y0, x1, y1] = normRect(drag.rect);
      g.fillStyle = 'rgba(255,179,71,.12)'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.strokeStyle = '#FFB347'; g.lineWidth = 1.2; g.setLineDash([5, 3]); g.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1); g.setLineDash([]);
    }
    g.restore();
    // 세기 막대 줄
    g.save(); g.beginPath(); g.rect(LABEL, LANE_T, w - LABEL, LANE_H); g.clip();
    for (const { n, x, w: bw } of laneBars(geo)) {
      const y = laneY(n.vel), on = sel.has(n), act = drag && (drag.kind === 'lane' || drag.kind === 'vel') && drag.note === n;
      g.globalAlpha = insColor(n) ? 0.6 + 0.4 * n.vel / 127 : 1;
      g.fillStyle = noteFill(n); g.fillRect(x, y, bw, LANE_B - LANE_PAD - y);
      g.globalAlpha = 1;
      g.fillStyle = on || act ? '#FFFFFF' : '#FFD9A8'; g.fillRect(x - 0.5, y - 1, bw + 1, 2.5); // 막대 머리 (잡는 곳)
      if (on) { g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1; g.strokeRect(x - 0.5, y - 0.5, bw + 1, LANE_B - LANE_PAD - y + 1); }
    }
    g.restore();
    // 세기 조절 중: 값 표시 ("세기 n")
    if (drag && (drag.kind === 'vel' || drag.kind === 'lane') && drag.note && d.tracks[S.track].includes(drag.note)) {
      const n = drag.note, r = hi - n.midi;
      const inRoll = drag.kind === 'vel' && visible(n);
      const x = Math.min(Math.max(LABEL, tx(geo, Math.max(from, n.step))), w - 76);
      const y = inRoll ? Math.max(0, RULER + r * ROWH - 28) : LANE_T - 28;
      if (inRoll || drag.kind === 'lane') {
        g.fillStyle = 'rgba(10,7,3,.94)'; roundRect(g, x, y, 74, 24, 6); g.fill();
        g.strokeStyle = AMBER; g.lineWidth = 1; roundRect(g, x, y, 74, 24, 6); g.stroke();
        g.fillStyle = AMBER; g.fillRect(x + 6, y + 17, 62 * n.vel / 127, 3);
        g.fillStyle = '#FFB067'; g.font = '800 11px system-ui,sans-serif'; g.textBaseline = 'middle'; g.fillText(`세기 ${n.vel}`, x + 6, y + 9);
      }
    }
    // 고른 음 옮기는 중: 얼마나 옮겼는지
    if (drag?.kind === 'move' && (drag.appS || drag.appM)) {
      const s = drag.appS / composeRes, txt = `${s > 0 ? '+' : ''}${+s.toFixed(2)}박 · ${drag.appM > 0 ? '+' : ''}${drag.appM}반음`;
      g.font = '800 11px system-ui,sans-serif'; const tw = g.measureText(txt).width + 12;
      g.fillStyle = 'rgba(10,7,3,.94)'; roundRect(g, w - tw - 4, RULER + 4, tw, 22, 6); g.fill();
      g.strokeStyle = AMBER; g.lineWidth = 1; roundRect(g, w - tw - 4, RULER + 4, tw, 22, 6); g.stroke();
      g.fillStyle = '#FFB067'; g.textBaseline = 'middle'; g.fillText(txt, w - tw + 2, RULER + 15);
    }
    // 바깥 옥타브 · 다른 마디의 음 표시
    const xs = d.tracks[S.track];
    const above = xs.filter((n) => n.midi > hi).length, below = xs.filter((n) => n.midi < lo).length;
    const left = xs.filter((n) => n.midi >= lo && n.midi <= hi && n.end <= from).length, right = xs.filter((n) => n.midi >= lo && n.midi <= hi && n.step >= from + span).length;
    g.font = '600 10px system-ui'; g.fillStyle = '#B4743A'; g.textBaseline = 'middle';
    if (above) g.fillText(`▲ ${above}`, w - 34, RULER + 9);
    if (below) g.fillText(`▼ ${below}`, w - 34, ROLL_B - 9);
    // 다른 마디에 있는 음 (눈금자 양 끝)
    const tag = (txt, x) => { const tw = g.measureText(txt).width + 8; g.fillStyle = '#0B0C0F'; g.fillRect(x, 0, tw, RULER); g.fillStyle = '#FFB067'; g.fillText(txt, x + 4, RULER / 2 + 0.5); };
    if (left) tag(`◀${left}`, 0);
    if (right) tag(`${right}▶`, w - g.measureText(`${right}▶`).width - 8);
  }
  function roundRect(g, x, y, w, h2, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h2, r); g.arcTo(x + w, y + h2, x, y + h2, r); g.arcTo(x, y + h2, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  const normRect = (r) => [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
  /** 네모에 걸린 (보이는) 음 */
  function rectNotes(geo, rect) {
    const [x0, y0, x1, y1] = normRect(rect), lo = low(), hi = lo + ROWS - 1;
    return d.tracks[S.track].filter((n) => {
      if (n.midi < lo || n.midi > hi || n.end <= geo.from || n.step >= geo.from + geo.span) return false;
      const nx0 = tx(geo, n.step), nx1 = tx(geo, n.end), ny0 = RULER + (hi - n.midi) * ROWH, ny1 = ny0 + ROWH;
      return nx1 > x0 && nx0 < x1 && ny1 > y0 && ny0 < y1;
    });
  }
  /** 캔버스 안 좌표 */
  function local(e) { const r = roll.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  /** 손가락 아래: 격자 칸 시작 틱(찍기용) · 정확한 틱(이미 있는 음 찾기용) · 음 높이 */
  function cellAt(e) {
    const r = roll.getBoundingClientRect(), geo = rollGeom();
    const x = e.clientX - r.left, y = e.clientY - r.top - RULER;
    if (x < LABEL || y < 0) return null;
    const c = Math.floor((x - LABEL) / geo.cellW), row = Math.floor(y / ROWH);
    if (c < 0 || c >= geo.cells || row < 0 || row >= ROWS) return null;
    const s = geo.from + c * geo.grid;
    const tick = Math.min(geo.from + geo.span - 1, geo.from + Math.floor((x - LABEL) / geo.tickW));
    if (s >= composeSteps) return null;
    return { s, tick, midi: low() + ROWS - 1 - row, x, y };
  }
  /** 길이 손잡이 (음 오른쪽 끝 · 손가락이 크면 조금 바깥까지) */
  function gripAt(e) {
    const c = cellAt(e); if (!c) return null;
    const geo = rollGeom(), end = geo.from + geo.span;
    let best = null, bd = 1e9;
    for (const n of d.tracks[S.track]) {
      if (n.midi !== c.midi || n.end > end || n.end <= geo.from) continue;
      const right = tx(geo, n.end) - 1.5, ww = n.len * geo.tickW - 3;
      const hz = Math.max(5, Math.min(12, ww * 0.45));
      if (c.x >= right - hz && c.x <= right + 5 && Math.abs(c.x - right) < bd) { best = n; bd = Math.abs(c.x - right); }
    }
    return best;
  }
  /** 세기 막대 줄에서 손가락 아래 막대 */
  function laneAt(e) {
    const [x, y] = local(e);
    if (y < LANE_T - 2 || y > LANE_B + 2 || x < LABEL) return null;
    let best = null, bd = 1e9;
    for (const b of laneBars(rollGeom())) {
      const dist = x < b.x ? b.x - x : x > b.x + b.w ? x - b.x - b.w : 0;
      if (dist < bd) { bd = dist; best = b.n; }
    }
    return bd <= 10 ? best : null;
  }
  const laneVel = (e) => Math.max(1, Math.min(127, Math.round((LANE_B - LANE_PAD - local(e)[1]) / (LANE_H - LANE_PAD * 2) * 127)));
  /** 길이 손잡이: 가장 가까운 격자선으로 끝을 맞춰요 (마디를 넘어도 돼요 · 화면 끝까지)
   *  화면 끝에 잠깐 머물면 다음(앞) 화면으로 넘어가서 계속 늘릴(줄일) 수 있어요 */
  function gripApply() {
    if (!drag || drag.kind !== 'grip') return;
    const geo = rollGeom(), n = drag.hnote, x = drag.lastX, g0 = geo.grid, pageEnd = geo.from + geo.span;
    let endT = geo.from + Math.round(Math.max(0, Math.min(geo.w - LABEL, x - LABEL)) / geo.cellW) * g0;
    endT = Math.min(endT, pageEnd, composeSteps);
    if (endT <= n.step) endT = Math.floor(n.step / g0) * g0 + g0;
    const before = n.len; d.setLen(S.track, n, endT - n.step);
    if (n.len !== before) { drag.moved = true; lcd(); changed(); }
    const dir = x >= geo.w - 6 && n.end >= pageEnd && pageEnd < composeSteps ? 1 : x <= LABEL + 4 && n.step < geo.from ? -1 : 0;
    clearTimeout(drag.edgeT);
    if (dir) drag.edgeT = setTimeout(() => { if (drag?.kind === 'grip') { turnPage(dir); gripApply(); } }, 450);
    drawRoll();
  }
  roll.addEventListener('pointerdown', (e) => {
    try { roll.focus({ preventScroll: true }); } catch { /* */ }
    if (e.button > 0) return;
    // 세기 막대 줄: 막대를 위아래로 끌어요
    const ln = laneAt(e);
    if (ln) {
      roll.setPointerCapture(e.pointerId);
      drag = { kind: 'lane', note: ln, moved: false };
      const v = laneVel(e); if (v !== ln.vel) { ln.vel = v; drag.moved = true; changed(); }
      drawRoll(); e.preventDefault(); return;
    }
    const c = cellAt(e); if (!c) return;
    // 격자보다 잘게 찍힌 음(긴 음의 가운데 포함)도 잡아요
    const n = d.notesCovering(S.track, c.tick, c.midi);
    roll.setPointerCapture(e.pointerId);
    drag = { note: n, hnote: gripAt(e), s0: c.s, midi0: c.midi, x0: e.clientX, y0: e.clientY, v0: n ? n.vel : 0, kind: null, moved: false,
      select: S.mode === 'select', shift: e.shiftKey, rect: null, appS: 0, appM: 0, wantS: 0, wantM: 0, snap: null };
    e.preventDefault();
  });
  roll.addEventListener('pointermove', (e) => {
    if (!drag) {
      roll.style.cursor = laneAt(e) ? 'ns-resize' : gripAt(e) ? 'ew-resize' : !cellAt(e) ? 'default'
        : S.mode === 'select' ? (S.sel.has(d.notesCovering(S.track, cellAt(e).tick, cellAt(e).midi)) ? 'move' : 'crosshair') : 'pointer';
      return;
    }
    if (drag.kind === 'lane') {
      const v = laneVel(e);
      if (v !== drag.note.vel) { drag.note.vel = v; drag.moved = true; drawRoll(); changed(); }
      return;
    }
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.kind && Math.hypot(dx, dy) > 6) {
      const horiz = Math.abs(dx) >= Math.abs(dy);
      if (drag.hnote && horiz) drag.kind = 'grip';
      else if (drag.select) {
        if (drag.note) {
          if (!S.sel.has(drag.note)) { if (!drag.shift) S.sel.clear(); S.sel.add(drag.note); toolsUi(); }
          drag.kind = 'move';
          // 끌기 시작할 때 트랙을 그대로 기억해요: 지나가기만 한 음은 지우지 않고, 놓은 자리에서만 겹친 음을 지워요
          drag.snap = { list: [...d.tracks[S.track]], pos: new Map(d.tracks[S.track].map((x) => [x, [x.step, x.midi, x.len]])) };
        } else { const [x, y] = local({ clientX: drag.x0, clientY: drag.y0 }); drag.kind = 'rect'; drag.rect = [x, y, x, y]; }
      } else if (drag.note) { drag.kind = horiz ? 'len' : 'vel'; if (drag.kind === 'vel') drawRoll(); }
    }
    if (drag.kind === 'grip') {
      drag.lastX = local(e)[0]; gripApply();
    } else if (drag.kind === 'len') {
      // 손가락이 있는 격자 칸의 끝까지 늘려요 (격자 단위로 딱딱 맞게)
      const geo = rollGeom(), r = roll.getBoundingClientRect();
      const c = Math.max(0, Math.min(geo.cells - 1, Math.floor((e.clientX - r.left - LABEL) / geo.cellW)));
      const endTick = geo.from + (c + 1) * geo.grid;
      const before = drag.note.len; d.setLen(S.track, drag.note, endTick - drag.note.step);
      if (drag.note.len !== before) { drag.moved = true; drawRoll(); lcd(); changed(); }
    } else if (drag.kind === 'vel') {
      const v = Math.max(1, Math.min(127, Math.round(drag.v0 - dy * 1.2)));
      if (v !== drag.note.vel) { drag.note.vel = v; drag.moved = true; drawRoll(); changed(); }
    } else if (drag.kind === 'move') {
      // 고른 음 모두: 가로는 격자 한 칸씩, 세로는 반음씩 · 매번 처음 상태로 되돌린 뒤 시작점부터의 전체 이동량으로 옮겨요
      const geo = rollGeom();
      const wantS = Math.round(dx / geo.cellW) * geo.grid, wantM = -Math.round(dy / ROWH);
      if (wantS !== drag.wantS || wantM !== drag.wantM) {
        drag.wantS = wantS; drag.wantM = wantM;
        restoreSnap(drag.snap);
        const [ms, mm] = d.moveNotes(S.track, selNotes(), wantS, wantM);
        if (ms !== drag.appS || mm !== drag.appM) { drag.appS = ms; drag.appM = mm; drag.moved = true; changed(); lcd(); }
      }
      drawRoll();
    } else if (drag.kind === 'rect') {
      const [x, y] = local(e), geo = rollGeom();
      drag.rect[2] = Math.max(LABEL, Math.min(geo.w, x)); drag.rect[3] = Math.max(RULER, Math.min(ROLL_B, y));
      drawRoll();
    }
  });
  /** 끌기 시작 때의 트랙으로 되돌리기 (같은 SeqNote 들 · 같은 순서 · 위치 · 길이) */
  function restoreSnap(snap) {
    const list = d.tracks[S.track];
    list.length = 0; list.push(...snap.list);
    for (const [n, [st, m, l]] of snap.pos) { n.step = st; n.midi = m; n.len = l; }
  }
  const endDrag = () => {
    if (!drag) return;
    clearTimeout(drag.edgeT);
    if (drag.kind === 'rect') {
      if (!drag.shift) S.sel.clear();
      for (const n of rectNotes(rollGeom(), drag.rect)) S.sel.add(n);
      toolsUi();
    } else if (drag.kind === 'move') {
      toolsUi(); playBtn();
    } else if (!drag.kind && !drag.moved && drag.select) {
      // 고르기: 음을 누르면 고르기/빼기 (Shift 는 더하기) · 빈 곳을 누르면 해제
      if (drag.note) { if (drag.shift) S.sel.add(drag.note); else if (S.sel.has(drag.note)) S.sel.delete(drag.note); else S.sel.add(drag.note); }
      else if (!drag.shift) S.sel.clear();
      toolsUi();
    } else if (!drag.kind && !drag.moved) {
      // 이미 있는 음을 누르면 지우고(붓을 든 멜로디면 그 악기로 칠하고), 빈 칸이면 격자 한 칸 길이로 찍어요
      const grid = GRIDS[S.grid];
      if (drag.note) d.toggle(S.track, drag.note.step, drag.note.midi, { len: grid });
      else d.toggle(S.track, drag.s0, drag.midi0, { len: grid });
      changed(); lcd(); playBtn();
    }
    drag = null; drawRoll();
  };
  roll.addEventListener('pointerup', endDrag);
  roll.addEventListener('pointercancel', () => {
    if (drag) { clearTimeout(drag.edgeT); if (drag.kind === 'move' && drag.snap) { restoreSnap(drag.snap); changed(); lcd(); toolsUi(); } }
    drag = null; drawRoll();
  });
  roll.addEventListener('wheel', (e) => {
    const c = cellAt(e);
    const n = c ? d.notesCovering(S.track, c.tick, c.midi) : laneAt(e); if (!n) return;
    e.preventDefault();
    n.vel = Math.max(1, Math.min(127, n.vel + (e.deltaY < 0 ? 6 : -6)));
    drawRoll(); changed();
  }, { passive: false });
  // 키보드 (시퀀서에 포커스가 있거나 포인터가 위에 있을 때): Delete · 화살표 · Esc · Ctrl/⌘+C · V
  let hover = false;
  root.addEventListener('pointerenter', () => { hover = true; });
  root.addEventListener('pointerleave', () => { hover = false; });
  const onKey = (e) => {
    if (!root.isConnected || (!hover && !root.contains(document.activeElement))) return;
    const t = e.target;
    if (t && (t.closest?.('input,textarea,select,[contenteditable=""],[contenteditable="true"],.knob') || t.isContentEditable)) return;
    if (document.querySelector('.seq-modal') || guideEl) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
      if (String(window.getSelection?.() || '')) return;
      e.preventDefault(); barCopy(); toast(`${S.bar + 1}마디를 복사했어요`); return;
    }
    if (mod && !e.shiftKey && !e.altKey && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); barPaste(false); return; }
    if (mod || e.altKey || S.track === 'drums') return;
    const sel = selNotes();
    if (e.key === 'Escape') { if (sel.length) { e.preventDefault(); clearSel(); toolsUi(); drawRoll(); } return; }
    if (!sel.length) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); return; }
    const mv = { ArrowLeft: [-GRIDS[S.grid], 0], ArrowRight: [GRIDS[S.grid], 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (mv) { e.preventDefault(); moveSel(mv[0], mv[1]); lcd(); toolsUi(); drawRoll(); }
  };
  document.addEventListener('keydown', onKey);
  /** 보이는 마디 넘기기 (좁은 화면 · 잘게 나눈 격자) */
  function turnPage(dir) {
    const geo = rollGeom();
    const first = geo.from / BAR_TICKS + dir * geo.bars;
    if (first < 0 || first >= composeBars) return;
    S.page = first; drawEditor();
  }

  // ---------- 드럼 머신 ----------
  function drawDrums() {
    const step = curStep(4);
    const cur = step >= 0 ? step % drumSteps : -1;
    $('sqDrums').innerHTML = drumLanes.map((lane) => `<div class="dl"><span class="dn">${esc(drumNames[lane])}</span>${
      Array.from({ length: drumSteps }, (_, i) => { const v = d.drum[lane][i]; return `<button class="dp${v > 0 ? ' on' : ''}${i === cur ? ' now' : ''}${i % 4 === 3 ? ' gap' : ''}" data-lane="${lane}" data-i="${i}" style="--v:${(v / 127).toFixed(2)}" aria-label="${esc(drumNames[lane])} ${i + 1}칸"></button>`; }).join('')
    }</div>`).join('') + `<div class="dl beats"><span class="dn"></span>${Array.from({ length: drumSteps }, (_, i) => `<i>${i % 4 === 0 ? i / 4 + 1 : '·'}</i>`).join('')}</div>`;
  }
  let ddrag = null;
  $('sqDrums').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.dp'); if (!b) return;
    const lane = b.dataset.lane, i = +b.dataset.i;
    ddrag = { lane, i, y0: e.clientY, v0: d.drum[lane][i], moved: false, el: b };
    b.setPointerCapture(e.pointerId);
  });
  $('sqDrums').addEventListener('pointermove', (e) => {
    if (!ddrag || ddrag.v0 === 0) return;
    const dy = e.clientY - ddrag.y0; if (Math.abs(dy) < 6 && !ddrag.moved) return;
    ddrag.moved = true;
    const v = Math.max(1, Math.min(127, Math.round(ddrag.v0 - dy * 1.2)));
    d.drum[ddrag.lane][ddrag.i] = v; ddrag.el.style.setProperty('--v', (v / 127).toFixed(2)); ddrag.el.title = `세기 ${v}`; changed();
  });
  $('sqDrums').addEventListener('pointerup', () => {
    if (!ddrag) return;
    if (!ddrag.moved) { d.toggleDrum(ddrag.lane, ddrag.i); changed(); lcd(); playBtn(); }
    ddrag = null; drawDrums();
  });

  // ---------- 노브 ----------
  const KNOBS = [['swing', 'Swing'], ['cutoff', 'Cutoff'], ['reverb', 'Reverb'], ['delay', 'Delay']];
  $('sqKnobs').innerHTML = KNOBS.map(([k, label]) => `<div class="knob" data-k="${k}" data-g="k_${k}" tabindex="0" role="slider" aria-label="${label}" aria-valuemin="0" aria-valuemax="100"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="25" class="kr"/><path class="ka"/><circle cx="30" cy="30" r="19" class="kb"/><line x1="30" y1="30" x2="30" y2="14" class="kn"/></svg><b>${label}</b><span class="kv"></span></div>`).join('');
  function arcPath(v) {
    const a0 = -135, a1 = a0 + 270 * v, rad = (a) => (a - 90) * Math.PI / 180, r = 25;
    const p = (a) => `${30 + r * Math.cos(rad(a))} ${30 + r * Math.sin(rad(a))}`;
    return v <= 0.001 ? '' : `M ${p(a0)} A ${r} ${r} 0 ${270 * v > 180 ? 1 : 0} 1 ${p(a1)}`;
  }
  function knobsUi() {
    root.querySelectorAll('.knob').forEach((el) => {
      const v = d[el.dataset.k];
      el.querySelector('.ka').setAttribute('d', arcPath(v));
      el.querySelector('.kn').setAttribute('transform', `rotate(${-135 + 270 * v} 30 30)`);
      el.querySelector('.kv').textContent = Math.round(v * 100);
      el.setAttribute('aria-valuenow', Math.round(v * 100));
    });
  }
  let kdrag = null;
  $('sqKnobs').addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.knob'); if (!el) return;
    kdrag = { k: el.dataset.k, y0: e.clientY, v0: d[el.dataset.k] }; el.setPointerCapture(e.pointerId); e.preventDefault();
  });
  $('sqKnobs').addEventListener('pointermove', (e) => {
    if (!kdrag) return;
    d[kdrag.k] = Math.max(0, Math.min(1, kdrag.v0 + (kdrag.y0 - e.clientY) / 160)); knobsUi(); lcd(); changed();
  });
  $('sqKnobs').addEventListener('pointerup', () => { kdrag = null; });
  $('sqKnobs').addEventListener('wheel', (e) => {
    const el = e.target.closest('.knob'); if (!el) return; e.preventDefault();
    d[el.dataset.k] = Math.max(0, Math.min(1, d[el.dataset.k] + (e.deltaY < 0 ? 0.03 : -0.03))); knobsUi(); lcd(); changed();
  }, { passive: false });
  $('sqKnobs').addEventListener('keydown', (e) => {
    const el = e.target.closest('.knob'); if (!el) return;
    const step = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05 }[e.key]; if (!step) return;
    e.preventDefault(); d[el.dataset.k] = Math.max(0, Math.min(1, d[el.dataset.k] + step)); knobsUi(); changed();
  });

  // ---------- 믹서 ----------
  function mixerUi() {
    const el = $('sqMixer');
    const strip = (t, name, m) => `<div class="strip" data-t="${t}">
      <b>${esc(name)}</b>
      <div class="ms"><button class="sq-mk m${m.mute ? ' on' : ''}" data-mute="${t}">M</button><button class="sq-mk s${m.solo ? ' on' : ''}" data-solo="${t}">S</button></div>
      <input type="range" class="pan" min="-100" max="100" value="${Math.round(m.pan * 100)}" data-pan="${t}" aria-label="${esc(name)} 좌우">
      <span class="pv">${Math.abs(m.pan) < 0.08 ? 'C' : m.pan < 0 ? 'L' + Math.round(-m.pan * 100) : 'R' + Math.round(m.pan * 100)}</span>
      <div class="fz${m.mute ? ' muted' : ''}"><canvas class="vu v" data-vu="${t}"></canvas><input type="range" class="fader" min="0" max="100" value="${Math.round(m.vol * 100)}" data-vol="${t}" aria-label="${esc(name)} 볼륨"></div>
      <span class="led">${Math.round(m.vol * 100)}</span></div>`;
    el.innerHTML = seqTracks.map((t) => strip(t, trackNames[t], d.mix[t])).join('') +
      `<div class="strip master"><b>Master</b><div style="height:62px"></div><div class="fz"><canvas class="vu v" data-vu="master"></canvas><input type="range" class="fader" min="0" max="100" value="${Math.round(d.master * 100)}" data-master aria-label="마스터 볼륨"></div><span class="led">${Math.round(d.master * 100)}</span></div>`;
  }
  $('sqMixer').addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.pan) { let v = +t.value / 100; if (Math.abs(v) < 0.08) v = 0; d.mix[t.dataset.pan].pan = v; t.nextElementSibling.textContent = v === 0 ? 'C' : v < 0 ? 'L' + Math.round(-v * 100) : 'R' + Math.round(v * 100); changed(); }
    if (t.dataset.vol) { d.mix[t.dataset.vol].vol = +t.value / 100; t.closest('.strip').querySelector('.led').textContent = t.value; changed(); }
    if ('master' in t.dataset) { d.master = +t.value / 100; t.closest('.strip').querySelector('.led').textContent = t.value; changed(); }
  });
  $('sqMixer').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mute],[data-solo]'); if (!b) return;
    const m = d.mix[b.dataset.mute || b.dataset.solo];
    if (b.dataset.mute) m.mute = !m.mute; else m.solo = !m.solo;
    mixerUi(); changed();
  });

  // ---------- VU 미터 (실제 미리 듣기 레벨 · 재생 위치에 맞춰) ----------
  const meters = new Map(); // canvas → { shown, peak, peakAt }
  function drawVu(cv, level, horizontal, segs) {
    const st = meters.get(cv) || { shown: 0, peak: 0, peakAt: 0 };
    const now = performance.now(), dt = Math.min(0.1, (now - (st.t || now)) / 1000); st.t = now;
    const db = level > 1e-5 ? 20 * Math.log10(level) : -120;
    const norm = Math.max(0, Math.min(1, (db + 42) / 42));
    st.shown = norm >= st.shown ? norm : Math.max(norm, st.shown - dt * 1.5);
    if (norm >= st.peak) { st.peak = norm; st.peakAt = now; } else if (now - st.peakAt > 900) st.peak = Math.max(st.shown, st.peak - dt * 0.7);
    meters.set(cv, st);
    const dpr = window.devicePixelRatio || 1, W = Math.min(cv.clientWidth, cv.parentElement?.clientWidth || cv.clientWidth), H = cv.clientHeight; // 줄 너비를 넘지 않게 (캔버스가 스스로 늘어나는 것 방지)
    if (!W || !H) return st.shown + st.peak;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const len = horizontal ? W : H, gap = 2, seg = (len - gap * (segs - 1)) / segs;
    const lit = Math.round(st.shown * segs), pk = st.peak > 0.02 ? Math.min(segs, Math.ceil(st.peak * segs)) - 1 : -1;
    for (let i = 0; i < segs; i++) {
      const k = (i + 1) / segs, c = k > 0.93 ? '#FF3B30' : k > 0.72 ? '#FFB347' : AMBER;
      const a = i * (seg + gap);
      const [x, y, w, hh] = horizontal ? [a, 0, seg, H] : [0, H - a - seg, W, seg];
      const on = i < lit || i === pk;
      g.shadowBlur = on ? 5 : 0; g.shadowColor = c;
      g.fillStyle = on ? c : '#17181D'; g.fillRect(x, y, w, hh);
      if (!on) { g.fillStyle = c + '1A'; g.fillRect(x, y, w, hh); }
    }
    g.shadowBlur = 0;
    return st.shown + st.peak;
  }
  function levelNow(name) {
    const lv = S.levels?.[name]; if (!lv || !S.playing) return 0;
    const f = Math.floor(audio.currentTime / vuHop);
    return f >= 0 && f < lv.length ? Math.max(lv[f], f > 0 ? lv[f - 1] : 0) : 0;
  }
  let raf = 0, lastStep = -2;
  function tick() {
    let live = S.playing ? 1 : 0;
    live += drawVu($('sqVuM'), levelNow('master'), true, 32);
    if (S.mixer) root.querySelectorAll('canvas[data-vu]').forEach((cv) => { live += drawVu(cv, levelNow(cv.dataset.vu), false, 14); });
    const s = curStep(4);
    if (s !== lastStep) { lastStep = s; if (S.playing) { lcd(); bars(); if (S.track === 'drums') drawDrums(); } }
    if (S.playing && S.track !== 'drums') drawRoll(); // 플레이헤드는 매 프레임 부드럽게
    raf = live > 0.002 ? requestAnimationFrame(tick) : 0;
  }
  const wake = () => { if (!raf) raf = requestAnimationFrame(tick); };

  // ---------- 미리 듣기 ----------
  function getWorker() {
    if (!worker) worker = new Worker(new URL('./seq-worker.js?v=20261113', import.meta.url), { type: 'module' });
    return worker;
  }
  function render() {
    return new Promise((res, rej) => {
      const id = ++reqId, w = getWorker();
      const onMsg = (e) => { if (e.data.id !== id) return; w.removeEventListener('message', onMsg); e.data.error ? rej(new Error(e.data.error)) : res(e.data); };
      w.addEventListener('message', onMsg);
      w.postMessage({ id, json: JSON.parse(JSON.stringify(d.toJson())), bpm: o.bpm() });
    });
  }
  async function play() {
    if (S.playing) { stop(); return; }
    if (!d.noteCount) return;
    S.busy = true; playBtn();
    try {
      const r = await render();
      S.levels = r.levels;
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      audioUrl = URL.createObjectURL(new Blob([r.wav], { type: 'audio/wav' }));
      audio.src = audioUrl;
      o.beforePlay?.();
      await audio.play();
      S.playing = true; wake();
    } catch (e) {
      toast(`미리 듣기를 만들지 못했어요 (${e.message || e})`);
    } finally { S.busy = false; playBtn(); }
  }
  function stop() { audio.pause(); S.playing = false; playBtn(); lcd(); bars(); drawEditor(); wake(); }
  audio.addEventListener('ended', () => { S.playing = false; playBtn(); lcd(); bars(); drawEditor(); wake(); });

  // ---------- 고급 코드 팔레트 ----------
  function palette() {
    const cur = d.slots[S.bar].copy();
    const box = h(`<div class="seq-modal"><div class="seq-sheet">
      <div class="seq-row"><b class="sh-t">${S.bar + 1}마디 · 고급 코드</b><div class="lcd sm" id="pcName"></div></div>
      <div class="sq-eng">근음</div><div class="chips" id="pcRoot"></div>
      <div class="sq-eng">종류 · 텐션</div><div class="chips" id="pcQ"></div>
      <div class="sq-eng">자리바꿈 (인버전)</div><div class="sq-seg" id="pcInv"></div>
      <div class="sh-btns"><button class="btn sub" data-x>취소</button><button class="btn" data-ok>${S.bar + 1}마디에 넣기</button></div>
    </div></div>`);
    const q = (id) => box.querySelector('#' + id);
    const ui = () => {
      q('pcName').textContent = chordLabel(cur, d.key);
      q('pcRoot').innerHTML = composeKeys.map((r) => `<button class="led${cur.root === r ? ' on' : ''}" data-r="${r}">${spellRoot(r, d.key)}</button>`).join('');
      q('pcQ').innerHTML = chordQualityNames.map((k) => `<button class="led${cur.quality === k ? ' on' : ''}" data-q="${esc(k)}">${esc(k || 'maj')}</button>`).join('');
      const n = (chordQualities[cur.quality] || [0, 0, 0]).length;
      const inv = ['기본', '1전위', '2전위', '3전위'].slice(0, n > 3 ? 4 : 3);
      q('pcInv').innerHTML = segHtml(inv, Math.min(cur.inv, inv.length - 1), 'data-inv');
    };
    box.addEventListener('click', (e) => {
      const t = e.target;
      if (t === box || t.closest('[data-x]')) return box.remove();
      if (t.dataset.r) cur.root = t.dataset.r;
      if (t.dataset.q !== undefined) cur.quality = t.dataset.q;
      if (t.dataset.inv !== undefined) cur.inv = +t.dataset.inv;
      if (t.closest('[data-ok]')) { d.placeChord(S.bar, cur); S.bar = (S.bar + 1) % composeBars; box.remove(); changed(); all(); return; }
      ui();
    });
    ui(); document.body.appendChild(box);
  }

  // ---------- MIDI 내보내기 (스케치 데이터라는 걸 분명히) ----------
  function midi() {
    const sum = d.midiSummary;
    const names = { lead: '멜로디', piano: '피아노', synth: '신스', bass: '베이스', drums: '드럼', chords: '코드' };
    const chips = Object.entries(sum).filter(([, c]) => c > 0).map(([k, c]) => `<span class="led on">${names[k] || k} · ${k === 'chords' ? c + '마디' : c}</span>`).join('') || '<span class="soft">아직 찍은 음이 없어요</span>';
    const box = h(`<div class="seq-modal"><div class="seq-sheet">
      <div class="seq-row"><b class="sh-t">🎹 MIDI로 내보내기</b><div class="lcd sm">${o.bpm()} BPM · ${esc(d.key)}</div></div>
      <div class="honest">ⓘ 이 파일은 내가 시퀀서에 직접 찍은 스케치(음 · 코드 · 드럼 · 템포)예요. <b>AI가 만든 완성곡의 MIDI가 아니에요.</b> 완성곡은 이 스케치를 참고해 AI가 새로 연주해서 음이 다를 수 있어요.</div>
      <div class="sq-eng">들어가는 트랙</div><div class="chips">${chips}</div>
      <p class="hint">로직 · 에이블톤 · FL 스튜디오 · 개러지밴드 등에서 열 수 있어요 (표준 MIDI · 트랙별 악기 · 세기 · 드럼 10번 채널). 믹서의 뮤트한 트랙도 들어가요.</p>
      <div class="sh-btns"><button class="btn sub" data-x>닫기</button><button class="btn" data-ok>⬇ .mid 파일 받기</button></div>
    </div></div>`);
    box.addEventListener('click', (e) => {
      if (e.target === box || e.target.closest('[data-x]')) return box.remove();
      if (e.target.closest('[data-ok]')) {
        try {
          const bytes = d.toMidi(o.bpm());
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([bytes], { type: 'audio/midi' }));
          a.download = `yarr_sketch_${d.key.replace('#', 's')}_${o.bpm()}bpm.mid`;
          document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          toast('MIDI 파일을 받았어요');
        } catch (err) { toast(`MIDI 파일을 만들지 못했어요 (${err.message || err})`); }
        box.remove();
      }
    });
    document.body.appendChild(box);
  }

  // ---------- 네온 가이드 ----------
  const SPOTS = () => [
    ['lcd', '▶ 내가 찍은 걸 바로 들어 보기'], ['meter', '지금 소리 크기 (빨간 칸 = 가장 큰 소리)'], ['key', '곡의 기본 음 (조)'],
    ['bars', '마디 4칸 · 고른 마디에 코드가 들어가요'], ['pads', '코드 패드 · 누르면 그 마디 코드로'], ['arp', '코드를 한 음씩 굴려서 연주'],
    ['tracks', '악기 고르기'], ['brush', '음표마다 다른 악기'], ['roll', S.track === 'drums' ? '드럼 비트 찍기' : '칸을 눌러 음 찍기'],
    ['k_swing', '리듬 출렁임'], ['k_cutoff', '소리 먹먹하게 ↔ 또렷하게'], ['k_reverb', '소리 공간감'], ['k_delay', '메아리'],
    ['mixer', '악기별 크기 · 좌우 · 끄기'], ['midi', 'DAW로 가져갈 MIDI 파일'],
  ];
  let guideEl = null, guideRaf = 0;
  function guide() {
    if (guideEl) return;
    try { localStorage.setItem(GUIDE_KEY, '1'); } catch { /* 저장 못 해도 괜찮아요 */ }
    guideEl = h(`<div class="neon-guide"><canvas></canvas><div class="ng-labels"></div>
      <p class="ng-top">화면을 누르면 닫혀요 · 스크롤하면 다른 부분 설명도 보여요</p><button class="ng-close">가이드 닫기</button></div>`);
    document.body.appendChild(guideEl);
    const cv = guideEl.querySelector('canvas'), labels = guideEl.querySelector('.ng-labels');
    const close = () => { cancelAnimationFrame(guideRaf); guideEl?.remove(); guideEl = null; };
    guideEl.querySelector('.ng-close').onclick = close;
    // 화면을 누르면 닫혀요 (스크롤은 막지 않아요)
    let down = null;
    const onDown = (e) => { down = [e.clientX, e.clientY]; };
    const onUp = (e) => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 8 && guideEl) {
      e.preventDefault(); e.stopPropagation(); close();
      // 가이드를 닫은 그 탭이 아래 버튼까지 눌리지 않게 바로 뒤 click 한 번은 삼켜요
      const eat = (c) => { c.preventDefault(); c.stopPropagation(); window.removeEventListener('click', eat, true); };
      window.addEventListener('click', eat, true); setTimeout(() => window.removeEventListener('click', eat, true), 400);
    } down = null; };
    window.addEventListener('pointerdown', onDown, true); window.addEventListener('pointerup', onUp, true);
    const cleanup = () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('pointerup', onUp, true); };
    const loop = () => {
      if (!guideEl) return cleanup();
      const W = innerWidth, H = innerHeight, dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      g.fillStyle = 'rgba(0,0,0,.65)'; g.fillRect(0, 0, W, H);
      let html = '';
      for (const [k, text] of SPOTS()) {
        const el = root.querySelector(`[data-g="${k}"]`); if (!el || !el.offsetParent) continue;
        const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > H || !r.width) continue;
        const x = r.left - 4, y = r.top - 4, w = r.width + 8, hh = r.height + 8;
        g.save(); g.globalCompositeOperation = 'destination-out'; roundRect(g, x, y, w, hh, 10); g.fill(); g.restore();
        g.shadowColor = 'rgba(255,140,0,.7)'; g.shadowBlur = 10; g.strokeStyle = '#FFA24A'; g.lineWidth = 1.2; roundRect(g, x, y, w, hh, 10); g.stroke(); g.shadowBlur = 0;
        const lw = Math.max(84, Math.min(230, w + 24)), above = y > 64;
        const left = Math.max(6, Math.min(W - lw - 6, x + w / 2 - lw / 2));
        html += `<span style="left:${left}px;width:${lw}px;${above ? `bottom:${H - y + 4}px` : `top:${y + hh + 4}px`}">${esc(text)}</span>`;
      }
      if (labels._h !== html) { labels.innerHTML = html; labels._h = html; }
      guideRaf = requestAnimationFrame(loop);
    };
    loop();
  }

  // ---------- 클릭 ----------
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button,[data-act]'); if (!b || !root.contains(b)) return;
    const act = b.dataset.act;
    if (act === 'play') return play();
    if (act === 'guide') return guide();
    if (act === 'example') { d.loadExample(); clearSel(); changed(); return all(); }
    if (act === 'autoAll') return auto(true);
    if (act === 'autoTrack') return auto(false);
    if (act === 'lockTrack') { A.locked.has(S.track) ? A.locked.delete(S.track) : A.locked.add(S.track); return autoUi(); }
    if (act === 'lockChords') { A.locked.has('chords') ? A.locked.delete('chords') : A.locked.add('chords'); return autoUi(); }
    if (act === 'autoUndo') { const b = ComposeDraft.fromJson(A.undo); if (b) restoreFrom(d, b); clearSel(); A.undo = null; A.msg = '되돌렸어요'; changed(); return all(); }
    if (act === 'clear') { d.clearTrack(S.track); clearSel(); changed(); return all(); }
    if (act === 'barCopy') return barCopy();
    if (act === 'barPaste') return barPaste(false);
    if (act === 'barPasteTrack') return barPaste(true);
    if (act === 'selNone') { clearSel(); toolsUi(); return drawRoll(); }
    if (act === 'selDel') return deleteSel();
    if (act === 'nudgeL' || act === 'nudgeR' || act === 'nudgeU' || act === 'nudgeD') {
      const g0 = GRIDS[S.grid], mv = { nudgeL: [-g0, 0], nudgeR: [g0, 0], nudgeU: [0, 1], nudgeD: [0, -1] }[act];
      moveSel(mv[0], mv[1]); lcd(); toolsUi(); return drawRoll();
    }
    if (b.dataset.mode !== undefined) { S.mode = b.dataset.mode === 'select' ? 'select' : 'draw'; if (S.mode === 'draw') clearSel(); tracksUi(); return drawRoll(); }
    if (act === 'close') { stop(); return o.onClose?.(); }
    if (act === 'palette') return palette();
    if (act === 'midi') return midi();
    if (act === 'mixer') { S.mixer = !S.mixer; $('sqMixer').classList.toggle('hidden', !S.mixer); b.classList.toggle('open', S.mixer); if (S.mixer) mixerUi(); wake(); return; }
    if (act === 'octDown' && S.oct[S.track] > 1) { S.oct[S.track]--; return tracksUi(), drawRoll(); }
    if (act === 'octUp' && S.oct[S.track] < 6) { S.oct[S.track]++; return tracksUi(), drawRoll(); }
    if (b.dataset.key !== undefined) { d.setKey(composeKeys[+b.dataset.key]); changed(); return all(); }
    if (b.dataset.key6 !== undefined) { d.setKey(composeKeys[+b.dataset.key6 + 6]); changed(); return all(); }
    if (b.dataset.bar !== undefined) { S.bar = +b.dataset.bar; S.page = S.bar; C.msg = ''; bars(); pads(); clipUi(); if (S.track !== 'drums') drawEditor(); return; }
    if (act === 'pagePrev') return turnPage(-1);
    if (act === 'pageNext') return turnPage(1);
    if (b.dataset.grid !== undefined) { S.grid = +b.dataset.grid; tracksUi(); return drawEditor(); }
    if (b.dataset.pad !== undefined) { d.placeChord(S.bar, chordBank(d.key)[+b.dataset.pad]); S.bar = (S.bar + 1) % composeBars; C.msg = ''; changed(); lcd(); bars(); pads(); clipUi(); drawEditor(); playBtn(); return; }
    if (b.dataset.arp !== undefined) { d.arpMode = ['up', 'down', 'random'][+b.dataset.arp]; changed(); return arp(); }
    if (b.dataset.track !== undefined) { S.track = seqTracks[+b.dataset.track]; clearSel(); tracksUi(); lcd(); return drawEditor(); }
    if (b.dataset.voice !== undefined) { d.leadVoice = Object.keys(leadVoices)[+b.dataset.voice]; changed(); return tracksUi(); }
    if (b.dataset.brush !== undefined) { d.brush = b.dataset.brush || null; return tracksUi(); }
  });
  $('sqArp').addEventListener('change', (e) => { d.arp = e.target.checked; changed(); arp(); });
  const ro = new ResizeObserver(() => drawEditor()); ro.observe(root);

  all(); wake();
  // 처음 한 번은 가이드를 자동으로
  let seen = '1'; try { seen = localStorage.getItem(GUIDE_KEY); } catch { /* */ }
  if (!seen) setTimeout(() => { if (root.isConnected && root.offsetParent) guide(); }, 700);

  return {
    refresh: all,
    stop,
    destroy() { stop(); ro.disconnect(); document.removeEventListener('keydown', onKey); cancelAnimationFrame(raf); worker?.terminate(); if (audioUrl) URL.revokeObjectURL(audioUrl); guideEl?.remove(); },
  };
}
