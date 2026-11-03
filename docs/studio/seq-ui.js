// 🎛 웹 스텝 시퀀서 (앱 compose_panel.dart 와 같은 기능 · 2026-11-03)
//   LCD · PLAY · 마스터 VU · 조 · 코드 4마디 + 스마트 코드 패드 · ARP · 트랙 · 피아노 롤 / 드럼 머신
//   · 사운드 노브 · 5트랙 믹서(+VU) · MIDI 내보내기(스케치 데이터 안내) · 네온 가이드
// 데이터 · 합성은 seq-core.js (앱과 같은 계산) · 합성은 seq-worker.js 에서
import {
  ComposeDraft, ChordSlot, chordBank, chordQualities, chordQualityNames, composeKeys, composeBars, composeSteps, drumSteps,
  seqTracks, trackNames, leadVoices, drumLanes, drumNames, noteName, isBlack, vuHop,
} from './seq-core.js?v=20261104';

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
  const S = { track: 'lead', bar: 0, mixer: false, oct: { lead: 4, piano: 4, synth: 4, bass: 2 }, levels: null, playing: false, busy: false };
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
    <div class="seq-lcdrow" data-g="lcd">
      <div class="lcd"><div class="lcd-1" id="sqL1"></div><div class="lcd-2" id="sqL2"></div></div>
      <button class="transport" data-act="play" id="sqPlay"><span class="tp-ic">▶</span><span class="tp-tx">PLAY</span></button>
    </div>
    <div class="seq-meter" data-g="meter"><span class="led-lbl">MASTER</span><canvas class="vu h" id="sqVuM"></canvas></div>

    <div class="sq-eng">조 · KEY</div>
    <div class="sq-segs" data-g="key"><div class="sq-seg" id="sqKey1"></div><div class="sq-seg" id="sqKey2"></div></div>

    <div class="seq-row"><div class="sq-eng">스마트 코드 뱅크 · 마디를 고르고 패드를 누르세요</div><button class="seq-key" data-act="palette">고급 코드</button></div>
    <div class="sq-bars" id="sqBars" data-g="bars"></div>
    <div class="pads" id="sqPads" data-g="pads"></div>
    <div class="seq-row arp" data-g="arp">
      <span class="sq-eng">ARP</span>
      <label class="sw"><input type="checkbox" id="sqArp"><i></i></label>
      <div class="sq-seg" id="sqArpMode"></div>
    </div>

    <div class="sq-eng" style="margin-top:20px">트랙</div>
    <div class="sq-seg" id="sqTracks" data-g="tracks"></div>
    <div class="sq-seg" id="sqVoice" style="margin-top:10px"></div>
    <div class="seq-row oct" id="sqOctRow">
      <span class="sq-eng">옥타브</span><span style="flex:1"></span>
      <button class="oct-key" data-act="octDown">▼</button><div class="lcd sm" id="sqOct"></div><button class="oct-key" data-act="octUp">▲</button>
    </div>
    <div class="editor" data-g="roll"><canvas id="sqRoll"></canvas><div class="drums" id="sqDrums"></div></div>
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
    $('sqL1').textContent = `RECIPE: ${o.bpm()} BPM · KEY ${d.key} · ${d.chords.join(' ')}`;
    const step = curStep(1);
    $('sqL2').textContent = `${trackNames[S.track]} · NOTES ${d.noteCount} · SWING ${Math.round(d.swing * 100)}%${S.playing && step >= 0 ? ` · ▶ ${step % composeSteps + 1}/16` : ''}`;
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
    $('sqBars').innerHTML = d.slots.map((c, b) => `<button class="sq-bar${b === S.bar ? ' sq-sel' : ''}${s >= 0 && Math.floor((s % composeSteps) / 4) === b ? ' sq-play' : ''}" data-bar="${b}"><span>${esc(c.name)}</span></button>`).join('');
  }
  function pads() {
    const bank = chordBank(d.key);
    const cur = d.slots[S.bar].name;
    $('sqPads').innerHTML = bank.map((c, i) => `<button class="pad${c.name === cur ? ' on' : ''}" data-pad="${i}">${esc(c.name)}</button>`).join('');
  }
  function arp() {
    $('sqArp').checked = d.arp;
    $('sqArpMode').innerHTML = segHtml(['Up', 'Down', 'Random'], ['up', 'down', 'random'].indexOf(d.arpMode), 'data-arp');
    $('sqArpMode').classList.toggle('dim', !d.arp);
  }
  function tracksUi() {
    $('sqTracks').innerHTML = segHtml(seqTracks.map((t) => trackNames[t]), seqTracks.indexOf(S.track), 'data-track');
    const lead = S.track === 'lead';
    $('sqVoice').classList.toggle('hidden', !lead);
    if (lead) $('sqVoice').innerHTML = segHtml(Object.values(leadVoices), Object.keys(leadVoices).indexOf(d.leadVoice), 'data-voice');
    const drum = S.track === 'drums';
    $('sqOctRow').classList.toggle('hidden', drum);
    if (!drum) $('sqOct').textContent = `C${S.oct[S.track]} – C${S.oct[S.track] + 1}`;
    $('sqRoll').classList.toggle('hidden', drum);
    $('sqDrums').classList.toggle('hidden', !drum);
    $('sqHint').textContent = drum
      ? '한 마디 16칸을 4마디 내내 반복해요 · 스윙 노브로 뒷박을 사람처럼 살짝 밀어요 · 칸을 위아래로 끌면 세기'
      : '칸을 누르면 음 · 음을 옆으로 끌면 길이 · 음을 위아래로 끌면 세기(벨로시티) · PC에서는 음 위에서 휠로도 세기를 바꿔요';
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
  function all() { lcd(); keys(); bars(); pads(); arp(); tracksUi(); drawEditor(); knobsUi(); if (S.mixer) mixerUi(); foot(); playBtn(); }

  // ---------- 재생 위치 ----------
  // 소수 단위 재생 위치 (멜로디 칸 기준 · 0 ~ composeSteps)
  function curPos() {
    if (!S.playing) return -1;
    const beat = 60 / Math.min(180, Math.max(60, o.bpm()));
    return (audio.currentTime / beat) % composeSteps;
  }
  function curStep(unitsPerBeat) {
    if (!S.playing) return -1;
    const beat = 60 / Math.min(180, Math.max(60, o.bpm()));
    return Math.floor(audio.currentTime / (beat / unitsPerBeat));
  }

  // ---------- 피아노 롤 (canvas) ----------
  const ROWS = 13, LABEL = 34, ROWH = 24;
  const roll = $('sqRoll');
  let drag = null; // { kind: 'len'|'vel', note, x0, y0, v0, moved }
  function rollGeom() {
    const w = roll.clientWidth || roll.parentElement.clientWidth;
    return { w, cell: (w - LABEL) / composeSteps };
  }
  function low() { return 12 * (S.oct[S.track] + 1); }
  function drawEditor() { if (S.track === 'drums') drawDrums(); else drawRoll(); }
  function drawRoll() {
    const { w, cell } = rollGeom();
    const H = ROWS * ROWH, dpr = window.devicePixelRatio || 1;
    if (roll.width !== Math.round(w * dpr) || roll.height !== Math.round(H * dpr)) { roll.width = Math.round(w * dpr); roll.height = Math.round(H * dpr); roll.style.height = H + 'px'; }
    const g = roll.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, H);
    const lo = low();
    for (let r = 0; r < ROWS; r++) {
      const midi = lo + ROWS - 1 - r, y = r * ROWH;
      g.fillStyle = isBlack(midi) ? '#0B0C0F' : '#13151A';
      g.fillRect(LABEL, y, w - LABEL, ROWH);
      g.fillStyle = isBlack(midi) ? '#1A1B20' : '#2A2C33';
      g.fillRect(0, y + 1, LABEL - 3, ROWH - 2);
      g.fillStyle = midi % 12 === 0 ? '#FFB067' : '#8A857D';
      g.font = '600 10px ui-monospace,Menlo,monospace';
      g.textBaseline = 'middle';
      if (!isBlack(midi)) g.fillText(noteName(midi), 4, y + ROWH / 2);
      g.fillStyle = 'rgba(255,255,255,.04)';
      g.fillRect(LABEL, y + ROWH - 1, w - LABEL, 1);
    }
    for (let s = 0; s <= composeSteps; s++) {
      g.fillStyle = s % 4 === 0 ? 'rgba(255,140,0,.22)' : 'rgba(255,255,255,.05)';
      g.fillRect(LABEL + s * cell - (s % 4 === 0 ? 0.5 : 0), 0, s % 4 === 0 ? 1.5 : 1, H);
    }
    const pos = curPos();
    if (pos >= 0) {
      const step = Math.floor(pos);
      g.fillStyle = 'rgba(255,140,0,.08)';
      g.fillRect(LABEL + step * cell, 0, cell, H);
    }
    for (const n of d.tracks[S.track]) {
      const r = lo + ROWS - 1 - n.midi;
      if (r < 0 || r >= ROWS) continue;
      const x = LABEL + n.step * cell + 1.5, y = r * ROWH + 3, ww = n.len * cell - 3, hh = ROWH - 6;
      const a = 0.45 + 0.55 * n.vel / 127;
      g.shadowColor = 'rgba(255,140,0,.55)'; g.shadowBlur = 8 * a;
      g.fillStyle = `rgba(255,${Math.round(120 + 60 * (1 - a))},0,${a})`;
      roundRect(g, x, y, ww, hh, 4); g.fill();
      g.shadowBlur = 0;
      // 세기 막대
      g.fillStyle = 'rgba(26,14,2,.55)';
      g.fillRect(x + 3, y + hh - 4, Math.max(2, (ww - 6) * n.vel / 127), 2);
      if (drag && drag.kind === 'vel' && drag.note === n) {
        g.fillStyle = '#fff'; g.font = '700 11px ui-monospace,Menlo,monospace';
        g.fillText(`VEL ${n.vel}`, Math.min(x + 4, w - 60), Math.max(10, y - 8));
      }
    }
    // 플레이헤드 · 재생 위치를 얇은 선이 실시간으로 지나가요
    if (pos >= 0) {
      const x = LABEL + pos * cell;
      const grad = g.createLinearGradient(x - 14, 0, x, 0);
      grad.addColorStop(0, 'rgba(255,140,0,0)'); grad.addColorStop(1, 'rgba(255,140,0,.18)');
      g.fillStyle = grad; g.fillRect(x - 14, 0, 14, H);
      g.shadowColor = 'rgba(255,170,60,.95)'; g.shadowBlur = 10;
      g.fillStyle = '#FFC27A'; g.fillRect(x - 0.75, 0, 1.5, H);
      g.shadowBlur = 0;
      g.beginPath(); g.moveTo(x - 5, 0); g.lineTo(x + 5, 0); g.lineTo(x, 6); g.closePath(); g.fillStyle = '#FFB067'; g.fill();
      // 선이 지나가는 음은 잠깐 밝게
      for (const n of d.tracks[S.track]) {
        if (pos < n.step || pos > n.step + n.len) continue;
        const r = lo + ROWS - 1 - n.midi; if (r < 0 || r >= ROWS) continue;
        g.shadowColor = 'rgba(255,200,120,.9)'; g.shadowBlur = 14;
        g.strokeStyle = 'rgba(255,230,190,.9)'; g.lineWidth = 1.5;
        roundRect(g, LABEL + n.step * cell + 1.5, r * ROWH + 3, n.len * cell - 3, ROWH - 6, 4); g.stroke();
        g.shadowBlur = 0;
      }
    }
    // 바깥 옥타브 음 표시 (위 · 아래에 몇 개)
    const above = d.tracks[S.track].filter((n) => n.midi > lo + ROWS - 1).length, below = d.tracks[S.track].filter((n) => n.midi < lo).length;
    g.font = '600 10px system-ui'; g.fillStyle = '#B4743A';
    if (above) g.fillText(`▲ ${above}`, w - 34, 9);
    if (below) g.fillText(`▼ ${below}`, w - 34, H - 9);
  }
  function roundRect(g, x, y, w, h2, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h2, r); g.arcTo(x + w, y + h2, x, y + h2, r); g.arcTo(x, y + h2, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function cellAt(e) {
    const r = roll.getBoundingClientRect(); const { cell } = rollGeom();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < LABEL) return null;
    const s = Math.floor((x - LABEL) / cell), row = Math.floor(y / ROWH);
    if (s < 0 || s >= composeSteps || row < 0 || row >= ROWS) return null;
    return { s, midi: low() + ROWS - 1 - row, x, y };
  }
  roll.addEventListener('pointerdown', (e) => {
    const c = cellAt(e); if (!c) return;
    const n = d.noteAt(S.track, c.s, c.midi);
    roll.setPointerCapture(e.pointerId);
    drag = { note: n, s0: c.s, midi0: c.midi, x0: e.clientX, y0: e.clientY, v0: n ? n.vel : 0, kind: null, moved: false };
    e.preventDefault();
  });
  roll.addEventListener('pointermove', (e) => {
    if (!drag) { roll.style.cursor = cellAt(e) ? 'pointer' : 'default'; return; }
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.kind && drag.note && Math.hypot(dx, dy) > 6) drag.kind = Math.abs(dx) >= Math.abs(dy) ? 'len' : 'vel';
    if (drag.kind === 'len') {
      const { cell } = rollGeom(); const r = roll.getBoundingClientRect();
      const s = Math.max(0, Math.min(composeSteps - 1, Math.floor((e.clientX - r.left - LABEL) / cell)));
      const before = drag.note.len; d.setLen(S.track, drag.note, s - drag.note.step + 1);
      if (drag.note.len !== before) { drag.moved = true; drawRoll(); lcd(); changed(); }
    } else if (drag.kind === 'vel') {
      const v = Math.max(1, Math.min(127, Math.round(drag.v0 - dy * 1.2)));
      if (v !== drag.note.vel) { drag.note.vel = v; drag.moved = true; drawRoll(); changed(); }
    }
  });
  const endDrag = () => {
    if (!drag) return;
    if (!drag.kind && !drag.moved) { d.toggle(S.track, drag.s0, drag.midi0); changed(); lcd(); playBtn(); }
    drag = null; drawRoll();
  };
  roll.addEventListener('pointerup', endDrag);
  roll.addEventListener('pointercancel', () => { drag = null; drawRoll(); });
  roll.addEventListener('wheel', (e) => {
    const c = cellAt(e); if (!c) return;
    const n = d.noteAt(S.track, c.s, c.midi); if (!n) return;
    e.preventDefault();
    n.vel = Math.max(1, Math.min(127, n.vel + (e.deltaY < 0 ? 6 : -6)));
    drawRoll(); changed();
  }, { passive: false });

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
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
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
    if (!worker) worker = new Worker(new URL('./seq-worker.js?v=20261104', import.meta.url), { type: 'module' });
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
      q('pcName').textContent = cur.name;
      q('pcRoot').innerHTML = composeKeys.map((r) => `<button class="led${cur.root === r ? ' on' : ''}" data-r="${r}">${r}</button>`).join('');
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
    ['tracks', '악기 고르기'], ['roll', S.track === 'drums' ? '드럼 비트 찍기' : '칸을 눌러 음 찍기'],
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
    if (act === 'example') { d.loadExample(); changed(); return all(); }
    if (act === 'clear') { d.clearTrack(S.track); changed(); return all(); }
    if (act === 'close') { stop(); return o.onClose?.(); }
    if (act === 'palette') return palette();
    if (act === 'midi') return midi();
    if (act === 'mixer') { S.mixer = !S.mixer; $('sqMixer').classList.toggle('hidden', !S.mixer); b.classList.toggle('open', S.mixer); if (S.mixer) mixerUi(); wake(); return; }
    if (act === 'octDown' && S.oct[S.track] > 1) { S.oct[S.track]--; return tracksUi(), drawRoll(); }
    if (act === 'octUp' && S.oct[S.track] < 6) { S.oct[S.track]++; return tracksUi(), drawRoll(); }
    if (b.dataset.key !== undefined) { d.setKey(composeKeys[+b.dataset.key]); changed(); return all(); }
    if (b.dataset.key6 !== undefined) { d.setKey(composeKeys[+b.dataset.key6 + 6]); changed(); return all(); }
    if (b.dataset.bar !== undefined) { S.bar = +b.dataset.bar; bars(); pads(); return; }
    if (b.dataset.pad !== undefined) { d.placeChord(S.bar, chordBank(d.key)[+b.dataset.pad]); S.bar = (S.bar + 1) % composeBars; changed(); lcd(); bars(); pads(); drawEditor(); playBtn(); return; }
    if (b.dataset.arp !== undefined) { d.arpMode = ['up', 'down', 'random'][+b.dataset.arp]; changed(); return arp(); }
    if (b.dataset.track !== undefined) { S.track = seqTracks[+b.dataset.track]; tracksUi(); lcd(); return drawEditor(); }
    if (b.dataset.voice !== undefined) { d.leadVoice = Object.keys(leadVoices)[+b.dataset.voice]; changed(); return tracksUi(); }
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
    destroy() { stop(); ro.disconnect(); cancelAnimationFrame(raf); worker?.terminate(); if (audioUrl) URL.revokeObjectURL(audioUrl); guideEl?.remove(); },
  };
}
