// seq-core.js — browser/Node ES module port of yarr_app/lib/data/compose.dart
// (step sequencer data model · preview synth · MIDI export). No dependencies.
//
// Determinism notes:
//  - Dart's VM `math.Random(seed)` (MWC, Thomas Wang seed mix) is ported exactly (DartRandom),
//    so the arpeggiator 'random' shuffle and the drum noise match Dart sample-for-sample.
//  - Dart's `List.sort` (insertion sort <= 32, dual-pivot quicksort otherwise, NOT stable) is
//    ported exactly (dartSort), so MIDI event order for equal keys matches byte-for-byte.
//  - Dart's int `%` (always >= 0) and `round()` (ties away from zero) are reproduced.

// ─── constants ───
export const composeBars = 4;
export const composeSteps = composeBars * 4;
export const drumSteps = 16;
export const composeKeys = Object.freeze(['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']);
const _names = composeKeys;

export const seqTracks = Object.freeze(['lead', 'piano', 'synth', 'bass', 'drums']);
export const trackNames = Object.freeze({ lead: '멜로디', piano: '피아노', synth: '신스', bass: '베이스', drums: '드럼' });
export const leadVoices = Object.freeze({ guitar: '🎸 기타', piano: '🎹 피아노', strings: '🎻 스트링', synth: '🔊 신스' });
/** 음표마다 고르는 악기 (2026-11-04) · 멜로디 트랙 음표에 'i' 로 붙어요 (없으면 트랙 기본 악기) · 서버 PRO_NOTE_INS · GPU guide.py 와 같은 키 */
export const noteInstruments = Object.freeze({
  guitar: '🎸 기타', piano: '🎹 피아노', strings: '🎻 스트링', synth: '🔊 신스',
  flute: '🪈 플루트', sax: '🎷 색소폰', brass: '🎺 브라스', marimba: '🪵 마림바',
  bell: '🔔 벨', organ: '⛪ 오르간', epiano: '🎹 일렉 피아노', pluck: '🪕 플럭',
});
/** 악기별 음표 색 (피아노 롤) · 트랙 기본 악기는 주황 그대로 */
export const noteInsColors = Object.freeze({
  guitar: '#FF8C00', piano: '#F5D06B', strings: '#E0736B', synth: '#B07CFF', flute: '#7FD6FF', sax: '#FFB347',
  brass: '#FFD23F', marimba: '#C98B5A', bell: '#9FF0E0', organ: '#7F9CFF', epiano: '#FF7FBF', pluck: '#8BE37F',
});
export const composeParts = Object.freeze({
  guitar: '🎸 기타',
  piano: '🎹 피아노',
  bass: '🎚 베이스',
  strings: '🎻 스트링',
  synth: '🔊 신스',
});
export const drumLanes = Object.freeze(['kick', 'snare', 'hat', 'clap']);
export const drumNames = Object.freeze({ kick: 'Kick', snare: 'Snare', hat: 'Hi-Hat', clap: 'Clap' });

export const chordQualities = Object.freeze({
  '': [0, 4, 7],
  'm': [0, 3, 7],
  '7': [0, 4, 7, 10],
  'maj7': [0, 4, 7, 11],
  'm7': [0, 3, 7, 10],
  '9': [0, 4, 7, 10, 14],
  'maj9': [0, 4, 7, 11, 14],
  'm9': [0, 3, 7, 10, 14],
  'add9': [0, 4, 7, 14],
  '6': [0, 4, 7, 9],
  'sus2': [0, 2, 7],
  'sus4': [0, 5, 7],
  'dim': [0, 3, 6],
  'm7b5': [0, 3, 6, 10],
  'aug': [0, 4, 8],
});
// NOTE: JS objects put integer-like keys first ('7','9','6'). Use this for Dart insertion order.
export const chordQualityNames = Object.freeze(['', 'm', '7', 'maj7', 'm7', '9', 'maj9', 'm9', 'add9', '6', 'sus2', 'sus4', 'dim', 'm7b5', 'aug']);
const hasQ = (q) => Object.prototype.hasOwnProperty.call(chordQualities, q);
const hasKey = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const _serverQuality = {
  '': '', 'm': 'm', '7': '7', 'maj7': 'maj7', 'm7': 'm7', '9': '7', 'maj9': 'maj7', 'm9': 'm7',
  'add9': '', '6': '', 'sus2': '', 'sus4': 'sus4', 'dim': 'dim', 'm7b5': 'dim', 'aug': '',
};
const _major = [0, 2, 4, 5, 7, 9, 11];
const _scale8 = [0, 2, 4, 5, 7, 9, 11, 12];

/** VU level frame length (seconds) */
export const vuHop = 0.03;
export const midiPpq = 480;
export const arpModes = Object.freeze(['up', 'down', 'random']);

// ─── Dart semantics helpers ───
const mod = (a, n) => ((a % n) + n) % n;
const idiv = (a, b) => Math.floor(a / b); // Dart ~/ for non-negative operands (truncates)
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
/** Dart double.round(): ties away from zero */
export const dartRound = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));
const isMap = (j) => j !== null && typeof j === 'object' && !Array.isArray(j);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/** `(v as num?)?.toInt()` (non-numbers are treated as null instead of throwing) */
const toInt = (v) => (isNum(v) ? Math.trunc(v) : null);
const toDbl = (v) => (isNum(v) ? v : null);
/** Dart string interpolation of a JSON value */
const dstr = (v) => (v === null || v === undefined ? 'null' : String(v));

/** Exact port of the Dart VM `math.Random(seed)` (multiply-with-carry, base 2^32). */
export class DartRandom {
  constructor(seed) {
    const M = 64;
    let n = BigInt.asUintN(M, BigInt(seed));
    const u = (x) => BigInt.asUintN(M, x);
    n = u(u(~n) + u(n << 21n));
    n = n ^ (n >> 24n);
    n = u(n * 265n);
    n = n ^ (n >> 14n);
    n = u(n * 21n);
    n = n ^ (n >> 28n);
    n = u(n + u(n << 31n));
    if (n === 0n) n = 0x5a17n;
    this._lo = Number(n & 0xffffffffn);
    this._hi = Number(n >> 32n);
    for (let i = 0; i < 4; i++) this._nextState();
  }
  _nextState() {
    const A = 0xffffda61;
    const lo = this._lo;
    const p1 = A * (lo & 0xffff); // < 2^48
    const p2 = A * Math.floor(lo / 65536); // < 2^48
    const low = p1 + this._hi + (p2 % 65536) * 65536; // < 2^50, exact
    const newLo = low % 4294967296;
    const newHi = (Math.floor(low / 4294967296) + Math.floor(p2 / 65536)) % 4294967296;
    this._lo = newLo;
    this._hi = newHi;
  }
  nextInt(max) {
    if (!(max > 0) || max > 4294967296) throw new RangeError(`max must be in 1..2^32: ${max}`);
    if (max <= 0x40000000 && (max & -max) === max) {
      this._nextState();
      return this._lo % max; // == lo & (max-1) for powers of two
    }
    let rnd32, result;
    do {
      this._nextState();
      rnd32 = this._lo;
      result = rnd32 % max;
    } while (rnd32 - result + max > 4294967296);
    return result;
  }
  nextDouble() {
    return (this.nextInt(1 << 26) * 134217728 + this.nextInt(1 << 27)) / 9007199254740992;
  }
  nextBool() {
    return this.nextInt(2) === 0;
  }
}

/** Dart `List.shuffle(random)` */
export function dartShuffle(list, random) {
  let length = list.length;
  while (length > 1) {
    const pos = random.nextInt(length);
    length -= 1;
    const tmp = list[length];
    list[length] = list[pos];
    list[pos] = tmp;
  }
  return list;
}

/** Exact port of Dart's (unstable) `List.sort` from dart:_internal Sort. In place. */
export function dartSort(a, compare) {
  _doSort(a, 0, a.length - 1, compare);
  return a;
}
function _doSort(a, left, right, compare) {
  if (right - left <= 32) _insertionSort(a, left, right, compare);
  else _dualPivotQuicksort(a, left, right, compare);
}
function _insertionSort(a, left, right, compare) {
  for (let i = left + 1; i <= right; i++) {
    const el = a[i];
    let j = i;
    while (j > left && compare(a[j - 1], el) > 0) {
      a[j] = a[j - 1];
      j--;
    }
    a[j] = el;
  }
}
function _dualPivotQuicksort(a, left, right, compare) {
  const sixth = Math.trunc((right - left + 1) / 6);
  const index1 = left + sixth;
  const index5 = right - sixth;
  const index3 = Math.trunc((left + right) / 2);
  const index2 = index3 - sixth;
  const index4 = index3 + sixth;
  let el1 = a[index1], el2 = a[index2], el3 = a[index3], el4 = a[index4], el5 = a[index5];
  let t;
  if (compare(el1, el2) > 0) { t = el1; el1 = el2; el2 = t; }
  if (compare(el4, el5) > 0) { t = el4; el4 = el5; el5 = t; }
  if (compare(el1, el3) > 0) { t = el1; el1 = el3; el3 = t; }
  if (compare(el2, el3) > 0) { t = el2; el2 = el3; el3 = t; }
  if (compare(el1, el4) > 0) { t = el1; el1 = el4; el4 = t; }
  if (compare(el3, el4) > 0) { t = el3; el3 = el4; el4 = t; }
  if (compare(el2, el5) > 0) { t = el2; el2 = el5; el5 = t; }
  if (compare(el2, el3) > 0) { t = el2; el2 = el3; el3 = t; }
  if (compare(el4, el5) > 0) { t = el4; el4 = el5; el5 = t; }
  const pivot1 = el2, pivot2 = el4;
  a[index1] = el1;
  a[index3] = el3;
  a[index5] = el5;
  a[index2] = a[left];
  a[index4] = a[right];
  let less = left + 1, great = right - 1;
  const pivotsAreEqual = compare(pivot1, pivot2) === 0;
  if (pivotsAreEqual) {
    const pivot = pivot1;
    for (let k = less; k <= great; k++) {
      const ak = a[k];
      let comp = compare(ak, pivot);
      if (comp === 0) continue;
      if (comp < 0) {
        if (k !== less) { a[k] = a[less]; a[less] = ak; }
        less++;
      } else {
        while (true) {
          comp = compare(a[great], pivot);
          if (comp > 0) { great--; continue; }
          else if (comp < 0) { a[k] = a[less]; a[less++] = a[great]; a[great--] = ak; break; }
          else { a[k] = a[great]; a[great--] = ak; break; }
        }
      }
    }
  } else {
    for (let k = less; k <= great; k++) {
      const ak = a[k];
      if (compare(ak, pivot1) < 0) {
        if (k !== less) { a[k] = a[less]; a[less] = ak; }
        less++;
      } else if (compare(ak, pivot2) > 0) {
        while (true) {
          let comp = compare(a[great], pivot2);
          if (comp > 0) {
            great--;
            if (great < k) break;
            continue;
          } else {
            comp = compare(a[great], pivot1);
            if (comp < 0) { a[k] = a[less]; a[less++] = a[great]; a[great--] = ak; }
            else { a[k] = a[great]; a[great--] = ak; }
            break;
          }
        }
      }
    }
  }
  a[left] = a[less - 1];
  a[less - 1] = pivot1;
  a[right] = a[great + 1];
  a[great + 1] = pivot2;
  _doSort(a, left, less - 2, compare);
  _doSort(a, great + 2, right, compare);
  if (pivotsAreEqual) return;
  if (less < index1 && great > index5) {
    while (compare(a[less], pivot1) === 0) less++;
    while (compare(a[great], pivot2) === 0) great--;
    for (let k = less; k <= great; k++) {
      const ak = a[k];
      if (compare(ak, pivot1) === 0) {
        if (k !== less) { a[k] = a[less]; a[less] = ak; }
        less++;
      } else if (compare(ak, pivot2) === 0) {
        while (true) {
          let comp = compare(a[great], pivot2);
          if (comp === 0) {
            great--;
            if (great < k) break;
            continue;
          } else {
            comp = compare(a[great], pivot1);
            if (comp < 0) { a[k] = a[less]; a[less++] = a[great]; a[great--] = ak; }
            else { a[k] = a[great]; a[great--] = ak; }
            break;
          }
        }
      }
    }
    _doSort(a, less, great, compare);
  } else {
    _doSort(a, less, great, compare);
  }
}

// ─── note helpers ───
const _alias = { Db: 1, 'D#': 3, Gb: 6, 'G#': 8, 'A#': 10 };
export function pcOf(n) {
  const i = _names.indexOf(n);
  return i >= 0 ? i : (hasKey(_alias, n) ? _alias[n] : 0);
}
// 화면 표시용 이름 (키에 맞춰 #/♭): 샵 키(G D A E B F# C#)는 C# D# F# G# A#, 그 밖은 Db Eb Gb Ab Bb
//   저장 · 서버로 보내는 값은 그대로(composeKeys 이름) · 소리도 같아요. 이름만 키에 맞게 보여 줘요.
const _sharpNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const _flatNames = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const _sharpKeys = ['G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
export const usesSharps = (key) => _sharpKeys.includes(key);
export const spellPc = (pc, key) => (usesSharps(key) ? _sharpNames : _flatNames)[mod(pc, 12)];
export const spellRoot = (root, key) => spellPc(pcOf(root), key);
/** 'Abm7' → 키 E 에서는 'G#m7' (자리바꿈 /베이스 포함) */
export function chordLabel(slot, key) {
  const base = `${spellRoot(slot.root, key)}${slot.quality}`;
  if (!slot.inv) return base;
  const iv = hasQ(slot.quality) ? chordQualities[slot.quality] : chordQualities[''];
  return `${base}/${spellPc(pcOf(slot.root) + iv[clamp(slot.inv, 0, iv.length - 1)], key)}`;
}
export const noteName = (midi) => `${_names[mod(midi, 12)]}${Math.floor(midi / 12) - 1}`;
export const isBlack = (midi) => [1, 3, 6, 8, 10].includes(mod(midi, 12));

// ─── ChordSlot ───
export class ChordSlot {
  constructor(root, quality = '', inv = 0) {
    this.root = root;
    this.quality = quality;
    this.inv = inv;
  }
  get name() {
    const base = `${this.root}${this.quality}`;
    if (this.inv === 0) return base;
    const iv = hasQ(this.quality) ? chordQualities[this.quality] : chordQualities[''];
    const bass = mod(pcOf(this.root) + iv[clamp(this.inv, 0, iv.length - 1)], 12);
    return `${base}/${_names[bass]}`;
  }
  get serverName() {
    return `${this.root}${hasKey(_serverQuality, this.quality) ? _serverQuality[this.quality] : ''}`;
  }
  voicing({ base = 60 } = {}) {
    const iv = [...(hasQ(this.quality) ? chordQualities[this.quality] : chordQualities[''])];
    for (let i = 0; i < this.inv && i < iv.length; i++) iv[i] += 12;
    iv.sort((a, b) => a - b);
    let r = base + pcOf(this.root);
    if (r > base + 6) r -= 12;
    return iv.map((v) => r + v);
  }
  copy() {
    return new ChordSlot(this.root, this.quality, this.inv);
  }
  toJson() {
    return { root: this.root, q: this.quality, inv: this.inv };
  }
  static fromJson(j) {
    if (!isMap(j)) return new ChordSlot('C');
    const r = dstr(j.root ?? 'C');
    const q = dstr(j.q ?? '');
    return new ChordSlot(_names.includes(r) ? r : 'C', hasQ(q) ? q : '', clamp(toInt(j.inv) ?? 0, 0, 3));
  }
  /** 'Am7' → slot (legacy format) */
  static parse(c) {
    const root = c.length > 1 && (c[1] === '#' || c[1] === 'b') ? c.substring(0, 2) : c.substring(0, 1);
    let q = c.substring(root.length);
    if (!hasQ(q)) q = q.startsWith('m') ? 'm' : '';
    return new ChordSlot(_names[pcOf(root)], q);
  }
}

/** 16 chord pads for a key (4 × 4) */
export function chordBank(key) {
  const k = pcOf(key);
  const r = (deg) => _names[(k + _major[deg]) % 12];
  const C = (a, b) => new ChordSlot(a, b);
  return [
    C(r(0), 'maj7'), C(r(1), 'm7'), C(r(2), 'm7'), C(r(3), 'maj7'),
    C(r(4), '7'), C(r(5), 'm7'), C(r(6), 'm7b5'), C(r(0), 'add9'),
    C(r(0)), C(r(1), 'm'), C(r(3)), C(r(4)),
    C(r(5), 'm'), C(r(4), 'sus4'), C(r(1), 'm9'), C(r(3), 'maj9'),
  ];
}
export const chordsForKey = (key) => chordBank(key).slice(0, 9).map((c) => c.name);
/** Dart record (int, List<int>) → [rootPc, intervals] */
export function parseChord(c) {
  const s = ChordSlot.parse(c.split('/')[0]);
  return [pcOf(s.root), chordQualities[s.quality]];
}

// ─── SeqNote ───
export class SeqNote {
  constructor(step, midi, { len = 1, vel = 100, ins = null } = {}) {
    this.step = step;
    this.midi = midi;
    this.len = len;
    this.vel = vel;
    /** 이 음표만의 악기 (null = 트랙 기본) */
    this.ins = ins;
  }
  get end() {
    return this.step + this.len;
  }
  toJson() {
    return { s: this.step, m: this.midi, l: this.len, v: this.vel, ...(this.ins ? { i: this.ins } : {}) };
  }
  static fromJson(j) {
    if (!isMap(j)) return null;
    const s = toInt(j.s), m = toInt(j.m);
    if (s === null || m === null || s < 0 || s >= composeSteps || m < 24 || m > 108) return null;
    const i = typeof j.i === 'string' && hasKey(noteInstruments, j.i) ? j.i : null;
    return new SeqNote(s, m, { len: clamp(toInt(j.l) ?? 1, 1, composeSteps - s), vel: clamp(toInt(j.v) ?? 100, 1, 127), ins: i });
  }
}

// ─── TrackMix ───
export class TrackMix {
  constructor({ vol = 0.8, pan = 0, mute = false, solo = false } = {}) {
    this.vol = vol;
    this.pan = pan;
    this.mute = mute;
    this.solo = solo;
  }
  toJson() {
    return { vol: this.vol, pan: this.pan, mute: this.mute, solo: this.solo };
  }
  static fromJson(j, def) {
    return isMap(j)
      ? new TrackMix({
          vol: clamp(toDbl(j.vol) ?? def.vol, 0, 1),
          pan: clamp(toDbl(j.pan) ?? def.pan, -1, 1),
          mute: j.mute === true,
          solo: j.solo === true,
        })
      : def;
  }
}

const _voices = {
  piano: { partials: [1, 0.5, 0.25, 0.125], decay: 1.4, attack: 0.008, vibrato: 0 },
  guitar: { partials: [1, 0.75, 0.5, 0.32, 0.2, 0.12], decay: 3.4, attack: 0.003, vibrato: 0 },
  strings: { partials: [1, 0.62, 0.45, 0.3, 0.2, 0.12], decay: 0.12, attack: 0.14, vibrato: 0.006 },
  synth: { partials: [1, 0.5, 0.33, 0.25, 0.2, 0.16, 0.14, 0.12], decay: 0.45, attack: 0.01, vibrato: 0.003 },
  // 음표마다 고르는 악기 (2026-11-04 · 미리 듣기용 간단한 합성 · 실제 곡은 AI 가 진짜 악기로 연주해요)
  flute: { partials: [1, 0.22, 0.08, 0.03], decay: 0.12, attack: 0.05, vibrato: 0.005 },
  sax: { partials: [1, 0.8, 0.6, 0.45, 0.3, 0.2, 0.12], decay: 0.2, attack: 0.03, vibrato: 0.004 },
  brass: { partials: [1, 0.9, 0.7, 0.55, 0.4, 0.3, 0.2], decay: 0.25, attack: 0.04, vibrato: 0.002 },
  marimba: { partials: [1, 0, 0.35, 0, 0.08], decay: 3.0, attack: 0.002, vibrato: 0 },
  bell: { partials: [1, 0.6, 0.4, 0.25, 0.15], decay: 1.2, attack: 0.002, vibrato: 0 },
  organ: { partials: [1, 0.7, 0.5, 0.4, 0.3, 0.25], decay: 0.05, attack: 0.01, vibrato: 0.003 },
  epiano: { partials: [1, 0.35, 0.1, 0.05], decay: 1.6, attack: 0.004, vibrato: 0.002 },
  pluck: { partials: [1, 0.5, 0.3, 0.15, 0.08], decay: 4.0, attack: 0.002, vibrato: 0 },
  bass: { partials: [1, 0.55, 0.2, 0.08], decay: 2.0, attack: 0.004, vibrato: 0 },
};
const _gmProgram = { guitar: 25, piano: 0, strings: 48, synth: 81, flute: 73, sax: 65, brass: 61, marimba: 12, bell: 9, organ: 16, epiano: 4, pluck: 45 };
const _gmDrum = { kick: 36, snare: 38, hat: 42, clap: 39 };
const _keySig = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4 };
const _deg = [[0, 0], [1, 2], [2, 4], [3, 5], [4, 4], [6, 2], [7, 1], [8, 0], [9, 2], [10, 5], [12, 4], [13, 3], [14, 2], [15, 1]];
const _utf8 = new TextEncoder();

// ─── ComposeDraft ───
export class ComposeDraft {
  constructor() {
    this.key = 'C';
    this.slots = [new ChordSlot('C'), new ChordSlot('G'), new ChordSlot('A', 'm'), new ChordSlot('F')];
    /** per-track notes (not drums): {lead, piano, synth, bass} */
    this.tracks = {};
    for (const t of seqTracks) if (t !== 'drums') this.tracks[t] = [];
    /** drums: lane → 16 velocities (0 = off) */
    this.drum = {};
    for (const l of drumLanes) this.drum[l] = new Array(drumSteps).fill(0);
    this.leadVoice = 'guitar';
    /** 새로 찍는 멜로디 음표의 악기 (null = 트랙 기본) · 저장 안 해요 */
    this.brush = null;
    this.swing = 0;
    this.cutoff = 1;
    this.reverb = 0.25;
    this.delay = 0;
    this.arp = false;
    this.arpMode = 'up';
    this.mix = {
      lead: new TrackMix({ vol: 0.85 }),
      piano: new TrackMix({ vol: 0.6, pan: -0.25 }),
      synth: new TrackMix({ vol: 0.5, pan: 0.25 }),
      bass: new TrackMix({ vol: 0.75 }),
      drums: new TrackMix({ vol: 0.7 }),
    };
    this.master = 0.85;
  }

  get chords() {
    return this.slots.map((s) => s.name);
  }
  get notes() {
    return this.tracks.lead;
  }
  get drums() {
    return Object.values(this.drum).some((l) => l.some((v) => v > 0));
  }

  get _melodySource() {
    for (const t of ['lead', 'synth', 'piano']) {
      if (this.tracks[t].length) return ComposeDraft._topLine(this.tracks[t]);
    }
    return [];
  }
  static _topLine(xs) {
    const by = new Map();
    for (const n of xs) {
      const cur = by.get(n.step);
      if (cur == null || n.midi > cur.midi) by.set(n.step, n);
    }
    return dartSort([...by.values()], (a, b) => a.step - b.step);
  }
  get ready() {
    return this._melodySource.length >= 3;
  }

  noteAt(track, step, midi) {
    for (const n of this.tracks[track]) {
      if (n.midi === midi && step >= n.step && step < n.end) return n;
    }
    return null;
  }

  /** tap a cell: remove if hit, else add a new note (lead: one note per beat) */
  toggle(track, step, midi) {
    const list = this.tracks[track];
    const hit = this.noteAt(track, step, midi);
    // 멜로디 + 붓(악기)을 든 상태: 다른 악기 음표를 누르면 지우지 않고 그 악기로 칠해요
    const brush = track === 'lead' && this.brush && this.brush !== this.leadVoice ? this.brush : null;
    if (hit && track === 'lead' && (hit.ins ?? null) !== brush) {
      hit.ins = brush;
      return;
    }
    if (hit) {
      list.splice(list.indexOf(hit), 1);
      return;
    }
    if (track === 'lead') {
      for (let i = list.length - 1; i >= 0; i--) if (list[i].step === step) list.splice(i, 1);
      for (const n of list) if (n.step < step && n.end > step) n.len = step - n.step;
    }
    for (const n of list) if (n.midi === midi && n.step < step && n.end > step) n.len = step - n.step;
    let next = composeSteps;
    for (const n of list) if (n.midi === midi && n.step > step) next = Math.min(next, n.step);
    list.push(new SeqNote(step, midi, { len: clamp(1, 1, next - step), ins: track === 'lead' ? brush : null }));
  }

  /** change length (not past the next note in the same row; lead: not past any next note) */
  setLen(track, n, len) {
    const xs = this.tracks[track];
    let next = composeSteps;
    for (const x of xs) if (x !== n && x.midi === n.midi && x.step > n.step) next = Math.min(next, x.step);
    let maxLen = next - n.step;
    if (track === 'lead') {
      let nextAny = composeSteps;
      for (const x of xs) if (x !== n && x.step > n.step) nextAny = Math.min(nextAny, x.step);
      maxLen = Math.min(maxLen, nextAny - n.step);
    }
    n.len = clamp(len, 1, Math.max(1, maxLen));
  }

  toggleDrum(lane, i) {
    return (this.drum[lane][i] = this.drum[lane][i] > 0 ? 0 : 110);
  }

  /** chord pad: set the bar's chord and stamp a chord (or arpeggio) into the piano track */
  placeChord(bar, c) {
    this.slots[bar] = c.copy();
    const piano = this.tracks.piano;
    for (let i = piano.length - 1; i >= 0; i--) {
      const n = piano[i];
      if (n.step >= bar * 4 && n.step < bar * 4 + 4) piano.splice(i, 1);
    }
    const v = c.voicing();
    if (!this.arp) {
      for (const m of v) piano.push(new SeqNote(bar * 4, m, { len: 4, vel: 88 }));
      return;
    }
    let order;
    if (this.arpMode === 'down') order = [...v].reverse();
    else if (this.arpMode === 'random') order = dartShuffle([...v], new DartRandom(bar * 31 + v[0]));
    else order = v;
    for (let i = 0; i < 4; i++) {
      piano.push(new SeqNote(bar * 4 + i, order[i % order.length], { len: 1, vel: i === 0 ? 100 : 84 }));
    }
  }

  setKey(k) {
    const d = mod(mod(pcOf(k) - pcOf(this.key), 12) + 18, 12) - 6;
    for (const s of this.slots) s.root = _names[mod(pcOf(s.root) + d + 12, 12)];
    for (const list of Object.values(this.tracks)) {
      for (const n of list) n.midi = clamp(n.midi + d, 24, 108);
    }
    this.key = k;
  }

  loadExample() {
    const k = pcOf(this.key);
    this.slots.length = 0;
    this.slots.push(new ChordSlot(_names[k]), new ChordSlot(_names[(k + 7) % 12]), new ChordSlot(_names[(k + 9) % 12], 'm'), new ChordSlot(_names[(k + 5) % 12]));
    const lead = this.tracks.lead;
    lead.length = 0;
    for (const [step, dg] of _deg) {
      lead.push(new SeqNote(step, 60 + k + _scale8[dg], { len: step === 4 || step === 10 ? 2 : 1, vel: step % 4 === 0 ? 112 : 96 }));
    }
    this.tracks.piano.length = 0;
    this.tracks.synth.length = 0;
    const saveArp = this.arp;
    this.arp = false;
    for (let b = 0; b < composeBars; b++) this.placeChord(b, this.slots[b]);
    this.arp = saveArp;
    const bass = this.tracks.bass;
    bass.length = 0;
    for (let b = 0; b < composeBars; b++) {
      const r = pcOf(this.slots[b].root);
      bass.push(new SeqNote(b * 4, 36 + r, { len: 2, vel: 110 }), new SeqNote(b * 4 + 2, 36 + r + 7, { len: 2, vel: 92 }));
    }
    for (const l of drumLanes) this.drum[l].fill(0);
    for (const i of [0, 8, 10]) this.drum.kick[i] = 115;
    for (const i of [4, 12]) this.drum.snare[i] = 105;
    for (let i = 0; i < drumSteps; i += 2) this.drum.hat[i] = i % 4 === 0 ? 90 : 60;
  }

  clearTrack(t) {
    if (t === 'drums') {
      for (const l of drumLanes) this.drum[l].fill(0);
    } else {
      this.tracks[t].length = 0;
    }
  }
  clear() {
    for (const t of seqTracks) this.clearTrack(t);
  }

  get noteCount() {
    let c = 0;
    for (const l of Object.values(this.tracks)) c += l.length;
    for (const l of Object.values(this.drum)) c += l.filter((v) => v > 0).length;
    return c;
  }

  // ─── server JSON ───
  get _legacyNotes() {
    const k = pcOf(this.key);
    return this._melodySource.map((n) => {
      const rel = mod(n.midi - (60 + k), 12);
      let best = 0;
      for (let i = 0; i < _scale8.length; i++) {
        if (Math.abs(_scale8[i] - rel) < Math.abs(_scale8[best] - rel)) best = i;
      }
      if (best === 7 && n.midi < 60 + k + 6) best = 0;
      return { beat: n.step, pitch: best, len: clamp(n.len, 1, 8) };
    });
  }
  get _legacyParts() {
    const p = [this.leadVoice];
    const live = (t) => this.tracks[t].length > 0 && !this.mix[t].mute;
    if (live('piano')) p.push('piano');
    if (live('synth')) p.push('synth');
    if (live('bass')) p.push('bass');
    return [...new Set(p)].slice(0, 4);
  }

  toJson() {
    const tracks = {};
    for (const [t, xs] of Object.entries(this.tracks)) tracks[t] = xs.map((n) => n.toJson());
    const drum = {};
    for (const [l, xs] of Object.entries(this.drum)) drum[l] = [...xs];
    const mix = {};
    for (const [t, m] of Object.entries(this.mix)) mix[t] = m.toJson();
    return {
      key: this.key,
      chords: this.slots.map((s) => s.serverName),
      notes: this._legacyNotes,
      drums: this.drums && !this.mix.drums.mute,
      parts: this._legacyParts,
      pro: {
        v: 2,
        slots: this.slots.map((s) => s.toJson()),
        tracks,
        drum,
        lead: this.leadVoice,
        fx: { swing: this.swing, cutoff: this.cutoff, reverb: this.reverb, delay: this.delay },
        arp: { on: this.arp, mode: this.arpMode },
        mix,
        master: this.master,
      },
    };
  }

  /** Accepts a decoded JSON object (or a JSON string). Returns null if not an object. */
  static fromJson(j) {
    if (typeof j === 'string') {
      try { j = JSON.parse(j); } catch { return null; }
    }
    if (!isMap(j)) return null;
    const d = new ComposeDraft();
    const k = dstr(j.key ?? 'C');
    d.key = _names.includes(k) ? k : 'C';
    const pro = j.pro;
    if (isMap(pro) && (pro.v === 2 || pro.v === 3)) {
      // v3 (앱 2026-11-04 · 한 박 = res 틱): 웹 시퀀서는 박 단위라 박에 맞춰 읽어요 (같은 박 · 같은 음은 하나로)
      const res = pro.v === 3 && [1, 2, 4].includes(pro.res) ? pro.res : 1;
      const beatOf = (x) => (res === 1 || !isMap(x) ? x : { ...x, s: Math.floor(toInt(x.s) / res), l: Math.max(1, Math.round((toInt(x.l) ?? res) / res)) });
      const sl = pro.slots;
      if (Array.isArray(sl) && sl.length === composeBars) d.slots = sl.map((x) => ChordSlot.fromJson(x));
      const tr = pro.tracks;
      if (isMap(tr)) {
        for (const t of Object.keys(d.tracks)) {
          const xs = Array.isArray(tr[t]) ? tr[t] : [];
          for (const x of xs) {
            const n = SeqNote.fromJson(beatOf(x));
            if (n && !d.tracks[t].some((o) => o.step === n.step && o.midi === n.midi)) d.tracks[t].push(n);
          }
        }
      }
      const dr = pro.drum;
      if (isMap(dr)) {
        for (const l of drumLanes) {
          const xs = dr[l];
          if (Array.isArray(xs) && xs.length === drumSteps) d.drum[l] = xs.map((v) => clamp(toInt(v) ?? 0, 0, 127));
        }
      }
      const lv = dstr(pro.lead ?? 'guitar');
      d.leadVoice = hasKey(leadVoices, lv) ? lv : 'guitar';
      const fx = pro.fx;
      if (isMap(fx)) {
        const g = (n, def) => clamp(toDbl(fx[n]) ?? def, 0, 1);
        d.swing = g('swing', 0);
        d.cutoff = g('cutoff', 1);
        d.reverb = g('reverb', 0.25);
        d.delay = g('delay', 0);
      }
      const a = pro.arp;
      if (isMap(a)) {
        d.arp = a.on === true;
        d.arpMode = arpModes.includes(a.mode) ? a.mode : 'up';
      }
      const mx = pro.mix;
      if (isMap(mx)) {
        for (const t of Object.keys(d.mix)) d.mix[t] = TrackMix.fromJson(mx[t], d.mix[t]);
      }
      d.master = clamp(toDbl(pro.master) ?? 0.85, 0, 1);
      return d;
    }
    // legacy format (8 scale cells · instrument list)
    const ch = Array.isArray(j.chords) ? j.chords.map(dstr) : null;
    if (ch && ch.length === composeBars) d.slots = ch.map((c) => ChordSlot.parse(c));
    for (const n of Array.isArray(j.notes) ? j.notes : []) {
      if (!isMap(n)) continue;
      const b = toInt(n.beat), p = toInt(n.pitch);
      if (b !== null && p !== null && b >= 0 && b < composeSteps && p >= 0 && p < 8) {
        d.tracks.lead.push(new SeqNote(b, 60 + pcOf(d.key) + _scale8[p], { len: clamp(toInt(n.len) ?? 1, 1, 8) }));
      }
    }
    const parts = (Array.isArray(j.parts) ? j.parts : []).map(dstr);
    d.leadVoice = parts.find((x) => hasKey(leadVoices, x)) ?? 'guitar';
    if (j.drums !== false) {
      for (const i of [0, 8]) d.drum.kick[i] = 110;
      for (let i = 0; i < drumSteps; i += 4) d.drum.hat[i + 2] = 70;
    }
    return d;
  }

  // ─── preview synth (stereo 22.05 kHz WAV) ───
  previewWav(bpm, { loops = 2 } = {}) {
    return this.previewRender(bpm, { loops }).wav;
  }

  /**
   * Pure function of the draft (does not mutate it): returns
   * { wav: Uint8Array, levels: {lead,piano,synth,bass,drums,master: Float32Array} }.
   * levels = per-[vuHop] peak (0..1 = 0 dBFS), tracks post-fader/pan, master post-fx.
   */
  previewRender(bpm, { loops = 2 } = {}) {
    const sr = 22050;
    const beat = 60.0 / clamp(bpm, 60, 180);
    const barLen = dartRound(4 * beat * sr);
    const loopLen = barLen * composeBars;
    const total = loopLen * loops + sr * 2;
    const rnd = new DartRandom(7);
    const hz = (midi) => 440.0 * Math.pow(2, (midi - 69) / 12);
    const PI = Math.PI;
    const mix = this.mix, tracks = this.tracks, drum = this.drum, slots = this.slots;
    const swing = this.swing, cutoff = this.cutoff, delay = this.delay, reverb = this.reverb;

    const bufs = {};
    for (const t of seqTracks) bufs[t] = new Float64Array(total);
    const anySolo = Object.values(mix).some((m) => m.solo);
    const audible = (t) => !mix[t].mute && (!anySolo || mix[t].solo);

    const tone = (buf, at, f, dur, amp, { decay = 2.2, partials = [1, 0.5, 0.25, 0.125], attack = 0.008, vibrato = 0 } = {}) => {
      const n = dartRound(dur * sr);
      const blen = buf.length;
      for (let i = 0; i < n && at + i < blen; i++) {
        const t = i / sr;
        const ff = vibrato > 0 ? f * (1 + vibrato * Math.sin(2 * PI * 5.2 * t) * Math.min(1.0, t / 0.3)) : f;
        let x = 0.0;
        for (let k = 0; k < partials.length; k++) {
          if (ff * (k + 1) > sr / 2.2) break;
          x += partials[k] * Math.sin(2 * PI * ff * (k + 1) * t) * Math.exp(-t * decay * (1 + 0.6 * k));
        }
        const env = Math.min(1.0, t / attack) * (i > n - 400 ? (n - i) / 400 : 1.0);
        buf[at + i] += amp * x * env;
      }
    };

    const sixteenth = beat / 4;
    const swungDrum = (base, i) => base + dartRound((i * sixteenth + (i % 2 === 1 ? swing * sixteenth * 0.33 : 0)) * sr);

    for (let loop = 0; loop < loops; loop++) {
      const base = loop * loopLen;
      for (const t of ['lead', 'piano', 'synth', 'bass']) {
        if (!audible(t)) continue;
        const v = _voices[t === 'lead' ? this.leadVoice : t];
        const amp = t === 'lead' ? 0.34 : t === 'bass' ? 0.32 : t === 'synth' ? 0.16 : 0.12;
        for (const n of tracks[t]) {
          const at = base + dartRound(n.step * beat * sr);
          const nv = t === 'lead' && n.ins && _voices[n.ins] ? _voices[n.ins] : v; // 음표마다 다른 악기
          tone(bufs[t], at, hz(n.midi), n.len * beat * 0.98, amp * (0.35 + (0.65 * n.vel) / 127), {
            decay: t === 'synth' ? 0.2 : nv.decay,
            partials: nv.partials,
            attack: t === 'synth' ? 0.06 : nv.attack,
            vibrato: nv.vibrato,
          });
        }
      }
      if (tracks.piano.length === 0 && tracks.synth.length === 0 && audible('piano')) {
        for (let b = 0; b < composeBars; b++) {
          for (const m of slots[b].voicing({ base: 55 })) {
            tone(bufs.piano, base + b * barLen, hz(m), beat * 3.95, 0.05, { decay: 0.15, partials: [1, 0.5, 0.3, 0.15], attack: 0.12 });
          }
        }
      }
      if (audible('drums')) {
        const db = bufs.drums;
        const dlen = db.length;
        for (let b = 0; b < composeBars; b++) {
          const bs = base + b * barLen;
          for (let i = 0; i < drumSteps; i++) {
            const at = swungDrum(bs, i);
            const kv = drum.kick[i], sv = drum.snare[i], hv = drum.hat[i], cv = drum.clap[i];
            if (kv > 0) {
              let ph = 0.0;
              for (let s = 0; s < 0.22 * sr && at + s < dlen; s++) {
                const t = s / sr;
                ph += (2 * PI * (120 * Math.exp(-t * 25) + 42)) / sr;
                db[at + s] += ((0.55 * kv) / 127) * Math.sin(ph) * Math.exp(-t * 13);
              }
            }
            if (sv > 0) {
              for (let s = 0; s < 0.18 * sr && at + s < dlen; s++) {
                const t = s / sr;
                db[at + s] += (sv / 127) * (0.22 * (rnd.nextDouble() * 2 - 1) * Math.exp(-t * 22) + 0.16 * Math.sin(2 * PI * 190 * t) * Math.exp(-t * 30));
              }
            }
            if (hv > 0) {
              let prev = 0.0;
              for (let s = 0; s < 0.05 * sr && at + s < dlen; s++) {
                const w = rnd.nextDouble() * 2 - 1;
                db[at + s] += ((0.12 * hv) / 127) * (w - prev) * Math.exp((-s / sr) * 70);
                prev = w;
              }
            }
            if (cv > 0) {
              for (const off of [0.0, 0.011, 0.022]) {
                const a = at + dartRound(off * sr);
                for (let s = 0; s < 0.12 * sr && a + s < dlen; s++) {
                  db[a + s] += ((0.1 * cv) / 127) * (rnd.nextDouble() * 2 - 1) * Math.exp((-s / sr) * (off === 0.022 ? 18 : 60));
                }
              }
            }
          }
        }
      }
    }

    // mix (volume · equal-power pan)
    const l = new Float64Array(total), r = new Float64Array(total);
    for (const t of seqTracks) {
      if (!audible(t)) continue;
      const m = mix[t];
      const a = ((m.pan + 1) * PI) / 4;
      const gl = Math.cos(a) * m.vol * 1.4, gr = Math.sin(a) * m.vol * 1.4;
      const b = bufs[t];
      for (let i = 0; i < total; i++) {
        l[i] += b[i] * gl;
        r[i] += b[i] * gr;
      }
    }

    // cutoff (2 × 1-pole LPF · 300 Hz ~ 11 kHz)
    if (cutoff < 0.98) {
      const fc = 300 * Math.pow(11000 / 300, cutoff);
      const k = 1 - Math.exp((-2 * PI * fc) / sr);
      for (const ch of [l, r]) {
        let y = 0.0, y2 = 0.0;
        for (let i = 0; i < total; i++) {
          y += k * (ch[i] - y);
          y2 += k * (y - y2);
          ch[i] = y2;
        }
      }
    }

    // ping-pong delay (dotted eighth)
    if (delay > 0.02) {
      const d = dartRound(0.75 * beat * sr);
      const fb = 0.25 + delay * 0.35, wet = delay * 0.55;
      const dl = new Float64Array(total), dr = new Float64Array(total);
      for (let i = d; i < total; i++) {
        dl[i] = r[i - d] + dr[i - d] * fb;
        dr[i] = l[i - d] + dl[i - d] * fb;
      }
      for (let i = 0; i < total; i++) {
        l[i] += dl[i] * wet;
        r[i] += dr[i] * wet;
      }
    }

    // Schroeder reverb (4 comb + 2 allpass)
    if (reverb > 0.02) {
      const verb = (x, spread) => {
        const out = new Float64Array(total);
        for (const c of [1116, 1188, 1277, 1356]) {
          const dl = dartRound(((c + spread) * sr) / 44100);
          const buf = new Float64Array(dl);
          let idx = 0, lp = 0.0;
          const fbk = 0.72 + reverb * 0.12;
          for (let i = 0; i < total; i++) {
            const y = buf[idx];
            lp = y * 0.6 + lp * 0.4;
            buf[idx] = x[i] + lp * fbk;
            idx = (idx + 1) % dl;
            out[i] += y * 0.25;
          }
        }
        for (const a of [556, 441]) {
          const dl = dartRound(((a + spread) * sr) / 44100);
          const buf = new Float64Array(dl);
          let idx = 0;
          for (let i = 0; i < total; i++) {
            const b = buf[idx];
            const y = -out[i] + b;
            buf[idx] = out[i] + b * 0.5;
            idx = (idx + 1) % dl;
            out[i] = y;
          }
        }
        return out;
      };
      const vl = verb(l, 0), vr = verb(r, 23);
      const wet = reverb * 0.6;
      for (let i = 0; i < total; i++) {
        l[i] += vl[i] * wet;
        r[i] += vr[i] * wet;
      }
    }

    let peak = 1e-9;
    for (let i = 0; i < total; i++) peak = Math.max(peak, Math.max(Math.abs(l[i]), Math.abs(r[i])));
    const g = (0.9 / peak) * (0.4 + 0.6 * this.master);

    const hop = dartRound(vuHop * sr);
    const frames = Math.trunc((total + hop - 1) / hop);
    const peaks = (src, gain) => {
      const out = new Float32Array(frames);
      for (let f = 0; f < frames; f++) {
        let m = 0.0;
        const end = Math.min(total, (f + 1) * hop);
        for (let i = f * hop; i < end; i++) {
          const v = Math.abs(src[i] * gain);
          if (v > m) m = v;
        }
        out[f] = Math.min(1.0, m);
      }
      return out;
    };
    const levels = {};
    for (const t of seqTracks) {
      if (!audible(t)) {
        levels[t] = new Float32Array(frames);
        continue;
      }
      const m = mix[t];
      const a = ((m.pan + 1) * PI) / 4;
      const gain = Math.max(Math.cos(a), Math.sin(a)) * m.vol * 1.4 * g;
      levels[t] = peaks(bufs[t], gain);
    }
    {
      const out = new Float32Array(frames);
      for (let f = 0; f < frames; f++) {
        let m = 0.0;
        const end = Math.min(total, (f + 1) * hop);
        for (let i = f * hop; i < end; i++) {
          const v = Math.abs(Math.max(Math.abs(l[i]), Math.abs(r[i])) * g);
          if (v > m) m = v;
        }
        out[f] = Math.min(1.0, m);
      }
      levels.master = out;
    }

    const dataLen = total * 4;
    const wav = new Uint8Array(44 + dataLen);
    const dv = new DataView(wav.buffer);
    const str = (o, s) => {
      for (let i = 0; i < 4; i++) dv.setUint8(o + i, s.charCodeAt(i));
    };
    str(0, 'RIFF');
    dv.setUint32(4, 36 + dataLen, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, 2, true);
    dv.setUint32(24, sr, true);
    dv.setUint32(28, sr * 4, true);
    dv.setUint16(32, 4, true);
    dv.setUint16(34, 16, true);
    str(36, 'data');
    dv.setUint32(40, dataLen, true);
    for (let i = 0; i < total; i++) {
      // keep Dart's evaluation order (l*g)*32767 so rounding is identical
      dv.setInt16(44 + i * 4, clamp(dartRound(l[i] * g * 32767), -32768, 32767), true);
      dv.setInt16(44 + i * 4 + 2, clamp(dartRound(r[i] * g * 32767), -32768, 32767), true);
    }
    return { wav, levels };
  }

  // ─── MIDI export (format 1 · 480 ppq) ───
  static get midiPpq() {
    return midiPpq;
  }

  get midiSummary() {
    const out = {};
    for (const t of ['lead', 'piano', 'synth', 'bass']) out[t] = this.tracks[t].length;
    let hits = 0;
    for (const l of Object.values(this.drum)) hits += l.filter((v) => v > 0).length;
    out.drums = hits * composeBars;
    if (this.tracks.piano.length === 0 && this.tracks.synth.length === 0) out.chords = composeBars;
    return out;
  }

  toMidi(bpm) {
    const tempo = clamp(bpm, 60, 180);
    const beat = midiPpq, six = idiv(midiPpq, 4);
    const vlq = (v) => {
      const out = [v & 0x7f];
      v >>>= 7;
      while (v > 0) {
        out.unshift((v & 0x7f) | 0x80);
        v >>>= 7;
      }
      return out;
    };
    const text = (type, s) => {
      const b = _utf8.encode(s);
      return [0xff, type, ...vlq(b.length), ...b];
    };
    const track = (name, ev, head = []) => {
      dartSort(ev, (a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]));
      const body = [0, ...text(0x03, name)];
      for (const h of head) body.push(0, ...h);
      let last = 0;
      for (const [t, , bytes] of ev) {
        body.push(...vlq(t - last), ...bytes);
        last = t;
      }
      body.push(0, 0xff, 0x2f, 0);
      const n = body.length;
      return [0x4d, 0x54, 0x72, 0x6b, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff, ...body];
    };
    const setup = (ch, program, t) => {
      const m = this.mix[t];
      return [
        [0xc0 | ch, program],
        [0xb0 | ch, 7, clamp(dartRound(m.vol * 127), 0, 127)],
        [0xb0 | ch, 10, clamp(dartRound((m.pan + 1) * 63.5), 0, 127)],
      ];
    };
    const note = (ev, ch, at, len, midi, vel) => {
      ev.push([at, 1, [0x90 | ch, clamp(midi, 0, 127), clamp(vel, 1, 127)]]);
      ev.push([at + Math.max(1, len), 0, [0x80 | ch, clamp(midi, 0, 127), 0]]);
    };

    const us = dartRound(60000000 / tempo);
    const conductor = track(`YARR sketch - ${tempo} BPM - Key ${this.key}`, [], [
      [0xff, 0x51, 3, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff],
      [0xff, 0x58, 4, 4, 2, 24, 8],
      [0xff, 0x59, 2, (hasKey(_keySig, this.key) ? _keySig[this.key] : 0) & 0xff, 0],
      text(0x01, 'YARR step sequencer sketch (not the AI-generated song)'),
    ]);
    const chunks = [conductor];
    const names = { lead: 'Lead', piano: 'Piano', synth: 'Synth', bass: 'Bass' };
    const chans = { lead: 0, piano: 1, synth: 2, bass: 3 };
    for (const t of ['lead', 'piano', 'synth', 'bass']) {
      if (this.tracks[t].length === 0) continue;
      const ch = chans[t];
      const ev = [];
      for (const n of this.tracks[t]) if (t !== 'lead' || !n.ins || n.ins === this.leadVoice) note(ev, ch, n.step * beat, n.len * beat - 10, n.midi, n.vel);
      if (ev.length === 0) continue;
      const prog = t === 'lead' ? (hasKey(_gmProgram, this.leadVoice) ? _gmProgram[this.leadVoice] : 25) : t === 'piano' ? 0 : t === 'synth' ? 89 : 33;
      const lv = this.leadVoice;
      chunks.push(track(t === 'lead' ? `Lead (${lv[0].toUpperCase()}${lv.substring(1)})` : names[t], ev, setup(ch, prog, t)));
    }
    // 음표마다 고른 악기: 악기마다 따로 트랙 · 채널 (5~8 · 10~15)
    const used = [...new Set(this.tracks.lead.map((n) => n.ins).filter((x) => x && x !== this.leadVoice))];
    const freeCh = [5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
    used.slice(0, freeCh.length).forEach((ins, k) => {
      const ev = [];
      for (const n of this.tracks.lead) if (n.ins === ins) note(ev, freeCh[k], n.step * beat, n.len * beat - 10, n.midi, n.vel);
      chunks.push(track(`Lead (${ins[0].toUpperCase()}${ins.substring(1)})`, ev, setup(freeCh[k], _gmProgram[ins] ?? 25, 'lead')));
    });
    if (this.tracks.piano.length === 0 && this.tracks.synth.length === 0) {
      const ev = [];
      for (let b = 0; b < composeBars; b++) {
        for (const m of this.slots[b].voicing({ base: 55 })) note(ev, 4, b * 4 * beat, 4 * beat - 10, m, 80);
      }
      chunks.push(track(`Chords (${this.chords.join(' ')})`, ev, setup(4, 89, 'piano')));
    }
    const ev = [];
    for (let b = 0; b < composeBars; b++) {
      for (let i = 0; i < drumSteps; i++) {
        const at = b * 4 * beat + i * six + (i % 2 === 1 ? dartRound(this.swing * six * 0.33) : 0);
        for (const l of drumLanes) {
          const v = this.drum[l][i];
          if (v > 0) note(ev, 9, at, idiv(six, 2), _gmDrum[l], v);
        }
      }
    }
    if (ev.length) chunks.push(track('Drums', ev, setup(9, 0, 'drums')));

    let size = 14;
    for (const c of chunks) size += c.length;
    const out = new Uint8Array(size);
    out.set([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (chunks.length >> 8) & 0xff, chunks.length & 0xff, (midiPpq >> 8) & 0xff, midiPpq & 0xff], 0);
    let o = 14;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}

/**
 * Worker helper: render a preview from a draft's toJson() (object or JSON string).
 * Returns {wav, levels} like previewRender, or null if the JSON is not a draft.
 * In a worker: postMessage(res, [res.wav.buffer, ...Object.values(res.levels).map(a => a.buffer)])
 */
export function renderPreviewFromJson(json, bpm, { loops = 2 } = {}) {
  const d = ComposeDraft.fromJson(json);
  return d ? d.previewRender(bpm, { loops }) : null;
}

/** Transferable buffers of a previewRender result (for postMessage). */
export function previewTransferables(res) {
  return [res.wav.buffer, ...Object.values(res.levels).map((a) => a.buffer)];
}
