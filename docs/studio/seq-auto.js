// 🎲 자동 찍기 (2026-11-05): 장르에 맞는 코드 진행 · 베이스 · 반주 · 드럼 · 멜로디를 시퀀서 판에 채워요
// 앱 lib/data/compose_auto.dart 를 줄마다 옮긴 것 · 같은 seed 면 앱과 똑같은 음이 나와요 (DartRandom = Dart math.Random)
// 서버 · AI 를 부르지 않는 음악 규칙 기반 · 리듬 틀 위에 그 자리 코드음 · 음계 이웃음을 무작위로 골라 매번 새로 만들어요
import { composeBars, composeRes, composeSteps, composeKeys, drumLanes, drumSteps, chordQualities, pcOf, ChordSlot, SeqNote, DartRandom, ComposeDraft } from './seq-core.js?v=20261113';

export const autoParts = Object.freeze(['chords', 'lead', 'piano', 'synth', 'bass', 'drums']);
export const autoPartNames = Object.freeze({ chords: '코드', lead: '멜로디', piano: '피아노', synth: '신스', bass: '베이스', drums: '드럼' });

export function autoStyleOf(genre) {
  switch (genre) {
    case 'trot': return 'trot';
    case 'hiphop': return 'hiphop';
    case 'house': case 'edm': case 'disco': case 'techno': return 'house';
    case 'kballad': case 'piano': case 'ambient': case 'newage': case 'classical': return 'ballad';
    case 'citypop': case 'funk': case 'rnb': case 'soul': return 'groove';
    case 'jazz': case 'bossa': case 'lofi': return 'jazzy';
    case 'rock': case 'punk': case 'metal': return 'rock';
    case 'kpop': case 'synthwave': case 'dance': return 'kpop';
    case 'gugak': return 'gugak';
    default: return 'pop';
  }
}
export const autoStyleName = (genre) => ({ trot: '트로트', hiphop: '힙합', house: '하우스', ballad: '발라드', groove: '그루브(시티팝 · 펑크)', jazzy: '재즈 · 로파이', rock: '록', kpop: '케이팝', gugak: '국악 퓨전', pop: '팝' })[autoStyleOf(genre)];

// ─── 규칙 표 (앱과 같은 값) ───
const _deg = [0, 2, 4, 5, 7, 9, 11];
const _tri = ['', 'm', 'm', '', '', 'm', 'dim'];
const _sev = ['maj7', 'm7', 'm7', 'maj7', '7', 'm7', 'm7b5'];

/// 스타일별 코드 진행 후보 (도수 · 7화음 쓸지 · 특수: 'III7' = 3도 장7 · 트로트 단조 느낌)
const _progs = {
  'pop': [['1', '5', '6', '4'], ['6', '4', '1', '5'], ['1', '6', '4', '5'], ['4', '5', '3', '6']],
  'ballad': [['1', '5', '6', '3'], ['4', '5', '3', '6'], ['1', '3', '4', '5'], ['6', '4', '1', '5']],
  'trot': [['6', '2', 'III7', '6'], ['1', '4', '5x', '1'], ['6', '4', 'III7', '6']],
  'hiphop': [['6', '4', '6', '4'], ['2', '6', '2', '6'], ['6', '2', '4', '5']],
  'house': [['6', '4', '1', '5'], ['2', '5', '1', '6'], ['6', '5', '4', '5']],
  'groove': [['4', '3', '6', '2'], ['2', '5', '1', '6'], ['1', '6', '2', '5']],
  'jazzy': [['2', '5', '1', '6'], ['4', '3', '6', '1'], ['1', '6', '2', '5']],
  'rock': [['1', '5', '6', '4'], ['1', '4', '5', '4'], ['6', '4', '1', '5']],
  'kpop': [['6', '4', '1', '5'], ['4', '5', '6', '6'], ['1', '5', '6', '4']],
  'gugak': [['6', '1', '5', '6'], ['6', '2', '5', '6']],
};
const _sevStyles = new Set(['groove', 'jazzy', 'hiphop']);

/// 멜로디 리듬 틀: 한 마디(16틱) 안 [시작, 길이] · A(1 · 2 · 4마디) / B(3마디)
const _rhythmA = {
  'pop': [[[0, 4], [4, 2], [6, 2], [8, 4], [12, 4]], [[0, 2], [2, 2], [4, 4], [8, 6], [14, 2]], [[0, 6], [6, 2], [8, 4], [12, 2], [14, 2]]],
  'ballad': [[[0, 8], [8, 4], [12, 4]], [[0, 6], [6, 2], [8, 8]], [[0, 4], [4, 4], [8, 8]]],
  'trot': [[[0, 4], [4, 2], [6, 2], [8, 6], [14, 2]], [[0, 3], [3, 1], [4, 4], [8, 4], [12, 4]]],
  'hiphop': [[[0, 2], [2, 2], [4, 1], [6, 2], [10, 2], [12, 3]], [[0, 3], [3, 3], [6, 2], [10, 2], [12, 2], [14, 2]]],
  'house': [[[0, 2], [2, 2], [6, 2], [8, 2], [10, 2], [14, 2]], [[2, 2], [6, 2], [8, 3], [12, 2], [14, 2]]],
  'groove': [[[0, 3], [3, 3], [6, 2], [8, 4], [14, 2]], [[0, 2], [3, 3], [8, 3], [11, 3], [14, 2]]],
  'jazzy': [[[0, 3], [3, 3], [6, 6], [12, 4]], [[0, 4], [6, 2], [8, 3], [11, 5]]],
  'rock': [[[0, 4], [4, 4], [8, 2], [10, 2], [12, 4]], [[0, 2], [2, 2], [4, 4], [8, 8]]],
  'kpop': [[[0, 2], [2, 2], [4, 2], [6, 2], [8, 4], [12, 4]], [[0, 3], [3, 3], [6, 2], [8, 2], [10, 2], [12, 4]]],
  'gugak': [[[0, 6], [6, 2], [8, 4], [12, 4]], [[0, 4], [4, 2], [6, 2], [8, 8]]],
};
const _rhythmB = {
  'pop': [[[0, 2], [2, 2], [4, 2], [6, 2], [8, 8]], [[0, 4], [4, 4], [8, 4], [12, 4]]],
  'ballad': [[[0, 4], [4, 4], [8, 4], [12, 4]], [[0, 2], [2, 2], [4, 4], [8, 8]]],
  'trot': [[[0, 2], [2, 2], [4, 2], [6, 2], [8, 8]], [[0, 4], [4, 4], [8, 2], [10, 2], [12, 4]]],
  'hiphop': [[[0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 4]], [[0, 1], [2, 1], [4, 2], [8, 1], [10, 1], [12, 4]]],
  'house': [[[0, 4], [4, 4], [8, 4], [12, 4]], [[0, 2], [2, 2], [4, 2], [6, 2], [8, 8]]],
  'groove': [[[0, 2], [2, 2], [4, 2], [6, 4], [12, 4]], [[0, 4], [5, 3], [8, 2], [10, 6]]],
  'jazzy': [[[0, 2], [2, 2], [4, 2], [6, 2], [8, 8]], [[0, 6], [6, 6], [12, 4]]],
  'rock': [[[0, 2], [2, 2], [4, 2], [6, 2], [8, 8]], [[0, 8], [8, 8]]],
  'kpop': [[[0, 4], [4, 4], [8, 2], [10, 2], [12, 4]], [[0, 2], [2, 2], [4, 2], [6, 2], [8, 8]]],
  'gugak': [[[0, 4], [4, 4], [8, 8]], [[0, 2], [2, 2], [4, 4], [8, 8]]],
};

/// 베이스: 한 마디 안 [시작, 근음에서 반음, 길이]
const _bassPat = {
  'pop': [[0, 0, 6], [6, 0, 2], [8, 7, 4], [12, 0, 4]],
  'ballad': [[0, 0, 8], [8, 7, 8]],
  'trot': [[0, 0, 3], [4, -5, 2], [8, 7, 3], [12, -5, 2]], // 쿵 · 짝 사이 근음 · 5도
  'hiphop': [[0, 0, 4], [6, 0, 2], [10, 0, 2], [14, 7, 2]], // 엇박
  'house': [[2, 0, 2], [6, 12, 2], [10, 0, 2], [14, 12, 2]], // 뒷박 8분
  'groove': [[0, 0, 2], [3, 12, 1], [6, 0, 2], [8, 7, 2], [11, 0, 1], [14, 12, 2]],
  'jazzy': [[0, 0, 6], [6, 7, 2], [8, 7, 6], [14, 0, 2]],
  'rock': [[0, 0, 2], [2, 0, 2], [4, 0, 2], [6, 0, 2], [8, 0, 2], [10, 0, 2], [12, 7, 2], [14, 0, 2]],
  'kpop': [[0, 0, 3], [3, 0, 3], [6, 0, 2], [8, 7, 3], [11, 7, 3], [14, 0, 2]],
  'gugak': [[0, 0, 8], [8, 7, 8]],
};

/// 피아노: 화음을 칠 자리 [시작, 길이] (arp = 펼쳐 치기)
const _pianoPat = {
  'pop': [[0, 8], [8, 8]],
  'trot': [[4, 2], [12, 2]], // 짝 · 짝
  'hiphop': [[0, 6], [10, 6]],
  'house': [[2, 2], [6, 2], [10, 2], [14, 2]],
  'groove': [[0, 2], [3, 2], [6, 2], [10, 2], [12, 2]],
  'jazzy': [[0, 6], [10, 6]],
  'rock': [[0, 8], [8, 8]],
  'kpop': [[0, 3], [3, 3], [8, 3], [11, 3]],
  'gugak': [[0, 16]],
};
const _arpStyles = new Set(['ballad']);
const _padStyles = new Set(['ballad', 'house', 'kpop', 'groove', 'jazzy', 'gugak']);

/// 드럼 한 마디 16칸: 줄 → [칸, 세기]
const _drumPat = {
  'pop': {'kick': [[0, 112], [8, 108], [10, 90]], 'snare': [[4, 104], [12, 104]], 'hat': [[0, 86], [2, 62], [4, 86], [6, 62], [8, 86], [10, 62], [12, 86], [14, 62]]},
  'ballad': {'kick': [[0, 92], [8, 84]], 'snare': [[12, 78]], 'hat': [[0, 58], [4, 52], [8, 58], [12, 52]]},
  'trot': {'kick': [[0, 112], [8, 110]], 'snare': [[4, 100], [12, 100]], 'hat': [[2, 84], [6, 84], [10, 84], [14, 84]]},
  'hiphop': {'kick': [[0, 116], [7, 96], [10, 108]], 'snare': [[4, 110], [12, 110]], 'hat': [[0, 80], [2, 64], [4, 80], [6, 64], [8, 80], [10, 64], [12, 80], [14, 70], [15, 56]]},
  'house': {'kick': [[0, 118], [4, 118], [8, 118], [12, 118]], 'clap': [[4, 100], [12, 100]], 'hat': [[2, 92], [6, 92], [10, 92], [14, 92]]},
  'groove': {'kick': [[0, 110], [6, 92], [10, 100]], 'snare': [[4, 104], [7, 40], [12, 104], [15, 40]], 'hat': [[0, 80], [1, 50], [2, 80], [3, 50], [4, 80], [5, 50], [6, 80], [7, 50], [8, 80], [9, 50], [10, 80], [11, 50], [12, 80], [13, 50], [14, 80], [15, 50]]},
  'jazzy': {'kick': [[0, 96], [9, 80]], 'snare': [[4, 84], [12, 84]], 'hat': [[2, 62], [6, 62], [10, 62], [14, 62]]},
  'rock': {'kick': [[0, 116], [6, 100], [8, 112]], 'snare': [[4, 112], [12, 112]], 'hat': [[0, 96], [2, 90], [4, 96], [6, 90], [8, 96], [10, 90], [12, 96], [14, 90]]},
  'kpop': {'kick': [[0, 116], [6, 96], [8, 112], [11, 90]], 'clap': [[4, 106], [12, 106]], 'hat': [[0, 80], [2, 64], [4, 80], [6, 64], [8, 80], [10, 64], [12, 80], [14, 64]]},
  'gugak': {'kick': [[0, 100], [10, 88]], 'clap': [[6, 80], [12, 92]]},
};
const _swing = {'jazzy': 0.3, 'hiphop': 0.15, 'groove': 0.1};
const _leadVoice = {'ballad': 'piano', 'trot': 'strings', 'house': 'synth', 'kpop': 'synth', 'jazzy': 'piano', 'groove': 'piano', 'rock': 'guitar', 'hiphop': 'synth', 'gugak': 'strings', 'pop': 'guitar'};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const nameOf = (pc) => composeKeys[((pc % 12) + 12) % 12];
const bt = () => 4 * composeRes;

/**
 * 🎲 자동 찍기
 * parts: 새로 채울 줄 (전체 채우기 = autoParts · 이 트랙만 다시 = [지금 트랙])
 * locked: 🔒 잠근 줄은 건드리지 않아요
 * 코드를 새로 뽑으면 그 코드에 맞춰야 하는 줄(피아노 · 신스 · 베이스 · 멜로디)도 잠기지 않았으면 같이 다시 찍어요
 */
export function autoFill(d, { genre, seed, parts = autoParts, locked = new Set() }) {
  const style = autoStyleOf(genre);
  const rnd = new DartRandom(seed);
  const want = new Set([...parts].filter((p) => !locked.has(p)));
  if (want.has('chords')) {
    autoChords(d, style, rnd);
    for (const t of ['piano', 'synth', 'bass', 'lead']) if (!locked.has(t)) want.add(t);
  }
  if (want.has('piano')) autoPiano(d, style, rnd);
  if (want.has('synth')) autoSynth(d, style);
  if (want.has('bass')) autoBass(d, style, rnd);
  if (want.has('drums')) autoDrums(d, style, rnd);
  if (want.has('lead')) {
    autoLead(d, style, rnd);
    d.autoLeadSig = d.leadSig; // 손대기 전 모양 (고치면 'edited')
  }
}

/** 되돌리기: 저장해 둔 초안 값으로 덮어써요 (화면이 같은 초안 객체를 쥐고 있어서 내용만 바꿔요) */
export function restoreFrom(d, b) {
  d.key = b.key;
  d.slots.length = 0; d.slots.push(...b.slots);
  for (const t of Object.keys(d.tracks)) { d.tracks[t].length = 0; d.tracks[t].push(...b.tracks[t]); }
  for (const l of drumLanes) for (let i = 0; i < drumSteps; i++) d.drum[l][i] = b.drum[l][i];
  d.leadVoice = b.leadVoice;
  d.swing = b.swing;
  d.autoLeadSig = b.autoLeadSig;
}

function degChord(k, deg, seventh) {
  if (deg === 'III7') return new ChordSlot(nameOf(k + 4), '7');
  if (deg === '5x') return new ChordSlot(nameOf(k + 7), '7');
  const i = parseInt(deg, 10) - 1;
  return new ChordSlot(nameOf(k + _deg[i]), seventh ? _sev[i] : _tri[i]);
}

function autoChords(d, style, rnd) {
  const list = _progs[style] ?? _progs.pop;
  const p = list[rnd.nextInt(list.length)];
  const seventh = _sevStyles.has(style);
  const k = pcOf(d.key);
  d.slots.length = 0;
  d.slots.push(...p.map((x) => degChord(k, x, seventh)));
}

function autoPiano(d, style, rnd) {
  const piano = d.tracks.piano; piano.length = 0;
  const b16 = bt();
  for (let b = 0; b < composeBars; b++) {
    const v = d.slots[b].voicing();
    if (_arpStyles.has(style)) {
      const order = [...v, v[1 % v.length] + 12, ...[...v].reverse().slice(1)];
      for (let i = 0; i < 8; i++) piano.push(new SeqNote(b * b16 + i * 2, order[i % order.length], { len: 2, vel: i % 4 === 0 ? 84 : 66 + rnd.nextInt(8) }));
      continue;
    }
    for (const h of _pianoPat[style] ?? _pianoPat.pop) {
      for (const m of v) piano.push(new SeqNote(b * b16 + h[0], m, { len: h[1], vel: (h[0] % 4 === 0 ? 86 : 76) + rnd.nextInt(8) }));
    }
  }
}

function autoSynth(d, style) {
  const synth = d.tracks.synth; synth.length = 0;
  if (!_padStyles.has(style)) return;
  const b16 = bt();
  for (let b = 0; b < composeBars; b++) for (const m of d.slots[b].voicing({ base: 72 })) synth.push(new SeqNote(b * b16, m, { len: b16, vel: 64 }));
}

function autoBass(d, style, rnd) {
  const bass = d.tracks.bass; bass.length = 0;
  const b16 = bt();
  for (let b = 0; b < composeBars; b++) {
    const r = 36 + pcOf(d.slots[b].root);
    const root = r > 45 ? r - 12 : r;
    for (const p of _bassPat[style] ?? _bassPat.pop) {
      bass.push(new SeqNote(b * b16 + p[0], clamp(root + p[1], 28, 60), { len: p[2], vel: (p[0] % 4 === 0 ? 108 : 92) + rnd.nextInt(8) }));
    }
  }
}

function autoDrums(d, style, rnd) {
  for (const l of drumLanes) d.drum[l].fill(0);
  const pat = _drumPat[style] ?? _drumPat.pop;
  for (const l of drumLanes) for (const h of pat[l] ?? []) d.drum[l][h[0]] = clamp(h[1] - 4 + rnd.nextInt(9), 1, 127);
  d.swing = _swing[style] ?? 0;
}

function chordTones(c, lo, hi) {
  const iv = chordQualities[c.quality] ?? chordQualities[''];
  const r = pcOf(c.root);
  const pcs = new Set(iv.slice(0, 4).map((v) => (r + v) % 12));
  const out = [];
  for (let m = lo; m <= hi; m++) if (pcs.has(m % 12)) out.push(m);
  return out;
}
function nearest(xs, to) {
  let best = xs[0];
  for (const x of xs) if (Math.abs(x - to) < Math.abs(best - to)) best = x;
  return best;
}
function nearestIndex(xs, to) {
  let bi = 0;
  for (let i = 0; i < xs.length; i++) if (Math.abs(xs[i] - to) < Math.abs(xs[bi] - to)) bi = i;
  return bi;
}

/** 멜로디: A(1마디) · A'(2마디 · 같은 모양을 코드에 맞춰 옮김) · B(3마디 · 새 리듬) · A''(4마디 · 으뜸음으로 끝) */
function autoLead(d, style, rnd) {
  const lead = d.tracks.lead; lead.length = 0;
  d.leadVoice = _leadVoice[style] ?? 'guitar';
  const b16 = bt();
  const k = pcOf(d.key);
  const aList = _rhythmA[style] ?? _rhythmA.pop;
  const bList = _rhythmB[style] ?? _rhythmB.pop;
  const a = aList[rnd.nextInt(aList.length)];
  const bRh = bList[rnd.nextInt(bList.length)];
  let base = 60 + k;
  if (base > 66) base -= 12;
  const lo = base - 3, hi = base + 14;
  const scale = [];
  for (let m = lo; m <= hi; m++) if (_deg.includes((((m - k) % 12) + 12) % 12)) scale.push(m);
  let prev = base + 4;
  const aIdx = [];
  for (let bar = 0; bar < composeBars; bar++) {
    const isA = bar !== 2;
    const rh = isA ? a : bRh;
    const tones = chordTones(d.slots[bar], lo, hi);
    let shift = 0;
    if (isA && bar > 0 && aIdx.length) {
      const first = nearest(tones, scale[aIdx[0]]);
      shift = nearestIndex(scale, first) - aIdx[0];
    }
    for (let i = 0; i < rh.length; i++) {
      const s = rh[i][0], len = rh[i][1];
      const last = bar === composeBars - 1 && i === rh.length - 1;
      let m;
      if (last) {
        m = nearest(scale.filter((x) => (((x - k) % 12) + 12) % 12 === 0), prev);
      } else if (isA && bar > 0 && i < aIdx.length) {
        m = scale[clamp(aIdx[i] + shift, 0, scale.length - 1)];
        if (s % 4 === 0 && !tones.includes(m)) m = nearest(tones, m);
        if (s % 4 !== 0 && rnd.nextInt(4) === 0) m = scale[clamp(nearestIndex(scale, m) + (rnd.nextBool() ? 1 : -1), 0, scale.length - 1)];
      } else if (s % 4 === 0) {
        const pool = tones.filter((x) => Math.abs(x - prev) <= 7 && x !== prev);
        m = pool.length === 0 ? nearest(tones, prev) : pool[rnd.nextInt(pool.length)];
      } else {
        const idx = nearestIndex(scale, prev);
        const step = (rnd.nextBool() ? 1 : -1) * (rnd.nextInt(3) === 0 ? 2 : 1);
        m = scale[clamp(idx + step, 0, scale.length - 1)];
      }
      if (bar === 0) aIdx.push(nearestIndex(scale, m));
      const vel = last ? 100 : (s % 8 === 0 ? 108 : s % 4 === 0 ? 98 : 86) - 3 + rnd.nextInt(7);
      const l = last ? b16 - s : len;
      lead.push(new SeqNote(bar * b16 + s, m, { len: clamp(l, 1, composeSteps - (bar * b16 + s)), vel: clamp(vel, 1, 127) }));
      prev = m;
    }
  }
}
