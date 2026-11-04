"""직접 찍기 가이드 음원 (numpy 만)

도트 격자에 찍은 멜로디 + 마디별 코드를 'AI가 알아듣기 좋은' 짧은 가이드 음원으로 만들어요.
ACE-Step 1.5 의 커버(cover) 모드에 src_audio 로 넣으면, 이 음원의 멜로디 · 리듬 · 코드 구조를 따라 새 곡을 만들어요.

장난감 소리가 남지 않게
  - 삐- 하는 사인파 · 사각파 대신 배음(1 · 1/2 · 1/4 · 1/8)과 짧은 어택 · 자연 감쇠가 있는 일렉 피아노 · 플럭 소리
  - 코드는 부드러운 패드(늦은 어택), 베이스는 근음, 박마다 아주 작은 킥 · 하이햇 (리듬 단서)
곡 전체를 따라오게
  - 4마디를 곡 길이만큼 반복 · 처음 4마디는 코드만(인트로), 16마디마다 4마디는 멜로디를 줄여 간주처럼, 끝은 서서히 줄임

guide = {
  "bpm": 100,
  "chords": ["C", "G", "Am", "F"],              # 마디마다 하나 (1~8마디)
  "notes": [{"beat": 0, "pitch": 2, "len": 1}],  # beat: 0부터 (4마디면 0~15), pitch: 음계 칸 (0=도 … 7=높은 도), len: 박 수
  "key": "C",                                     # 음계 기준 (도의 위치) · 기본 C
  "pro": {...}                                    # (선택) 시퀀서 v2 · 아래
}

시퀀서 v2 (pro · 2026-11-03) — 앱의 피아노롤 · 드럼 머신 · 믹서를 그대로 소리로
  "pro": {
    "tracks": {"lead": [{"s": 0, "m": 64, "l": 2, "v": 100}], "piano": [...], "synth": [...], "bass": [...]},
        # s: 박(0부터) · m: MIDI 음높이(24~108, 반음까지) · l: 박 수 · v: 세기 1~127
    "drum": {"kick": [16칸], "snare": [16칸], "hat": [16칸], "clap": [16칸]},   # 한 마디 16분음표 · 값=세기 0~127 (0=쉼)
    "lead": "guitar" | "piano" | "strings" | "synth",                         # 리드 음색
    "mix": {"lead": {"vol": 0.8, "mute": false, "solo": false}, ..., "drums": {...}},
    "swing": 0.0~1.0                                                          # 홀수 16분음표를 늦게
  }
  pro 가 있으면 트랙마다 찍은 음을 그대로 (세기 = 크기 + 밝기), 비어 있는 파트만 예전 방식(코드 패드 · 근음 베이스 · 기본 드럼)으로 채워요.
  리드(멜로디)는 melody_gain 을 따라요 → 보컬곡 'gaps' 에서도 피아노 · 베이스 · 드럼은 그대로 남아 반주 단서가 돼요.
  팬 · 리버브 · 딜레이 · 컷오프는 모노 가이드라 넣지 않아요 (AI 커버가 음색은 새로 만들어요).
"""
from __future__ import annotations

import io
import wave

import numpy as np

SR = 44100
NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
ALIAS = {'Db': 1, 'D#': 3, 'Gb': 6, 'G#': 8, 'A#': 10, 'Cb': 11, 'Fb': 4, 'E#': 5, 'B#': 0}
MAJOR = [0, 2, 4, 5, 7, 9, 11, 12]   # 도레미파솔라시도


def _pc(name: str) -> int:
    return NAMES.index(name) if name in NAMES else ALIAS[name]


def parse_chord(c: str) -> tuple[int, list[int]]:
    """'Am' → (9, [0, 3, 7]) · 'G7' → (7, [0, 4, 7, 10]) · 모르는 꼬리는 장3화음"""
    c = c.strip()
    root = c[:2] if len(c) > 1 and c[1] in '#b' else c[:1]
    rest = c[len(root):]
    r = _pc(root)
    if rest.startswith('maj7'):
        iv = [0, 4, 7, 11]
    elif rest.startswith('m7'):
        iv = [0, 3, 7, 10]
    elif rest.startswith('m'):
        iv = [0, 3, 7]
    elif rest.startswith('7'):
        iv = [0, 4, 7, 10]
    elif rest.startswith('sus4'):
        iv = [0, 5, 7]
    elif rest.startswith('dim'):
        iv = [0, 3, 6]
    else:
        iv = [0, 4, 7]
    return r, iv


def hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def tone(f: float, dur: float, amp: float, attack: float = 0.008, decay: float = 2.2, partials=(1, .5, .25, .125)) -> np.ndarray:
    """일렉 피아노 · 플럭 비슷한 음: 배음 + 짧은 어택 + 지수 감쇠 + 끝 살짝 줄임"""
    n = max(1, int(dur * SR))
    t = np.arange(n) / SR
    x = np.zeros(n)
    for k, a in enumerate(partials, start=1):
        if f * k > SR / 2.2:
            break
        x += a * np.sin(2 * np.pi * f * k * t) * np.exp(-t * decay * (1 + 0.6 * (k - 1)))  # 높은 배음일수록 빨리 줄어요
    env = np.minimum(1.0, t / attack)
    rel = min(n, int(0.06 * SR))
    env[-rel:] *= np.linspace(1, 0, rel)
    return amp * x * env


def pad(freqs: list[float], dur: float, amp: float) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for f in freqs:
        for k, a in ((1, 1.0), (2, .35), (3, .12)):
            x += a * np.sin(2 * np.pi * f * k * t + k)
    env = np.minimum(1.0, t / 0.25) * np.minimum(1.0, (dur - t) / 0.3).clip(0, 1)
    return amp * x * env / max(1, len(freqs))


def kick(amp: float) -> np.ndarray:
    n = int(0.18 * SR)
    t = np.arange(n) / SR
    f = 110 * np.exp(-t * 22) + 45
    return amp * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 18)


def hat(amp: float, rng: np.random.Generator) -> np.ndarray:
    n = int(0.05 * SR)
    noise = rng.standard_normal(n)
    noise = noise - np.convolve(noise, np.ones(4) / 4, mode='same')   # 낮은 소리 빼기
    return amp * noise * np.exp(-np.arange(n) / SR * 80)


def snare(amp: float, rng: np.random.Generator) -> np.ndarray:
    """스네어: 몸통(190Hz 정도) + 잡음 줄"""
    n = int(0.16 * SR)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * (185 * np.exp(-t * 8) + 15) * t) * np.exp(-t * 30)
    noise = rng.standard_normal(n)
    noise = noise - np.convolve(noise, np.ones(3) / 3, mode='same')
    return amp * (0.55 * body + 0.6 * noise * np.exp(-t * 22))


def clap(amp: float, rng: np.random.Generator) -> np.ndarray:
    """박수: 아주 짧은 잡음 세 번 + 꼬리"""
    n = int(0.2 * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    noise = np.convolve(noise, np.array([1, 0, -1]) / 2, mode='same')   # 가운데 음역만
    env = np.zeros(n)
    for d in (0.0, 0.011, 0.022):
        k = t >= d
        env[k] = np.maximum(env[k], np.exp(-(t[k] - d) * (220 if d < 0.02 else 28)))
    return amp * noise * env


def _add(buf: np.ndarray, x: np.ndarray, at: int) -> None:
    if at >= len(buf):
        return
    end = min(len(buf), at + len(x))
    buf[at:end] += x[: end - at]


# 리드 음색 (배음 · 어택 · 감쇠) — 커버 AI가 '어떤 악기로 연주한 선율인지' 알아듣는 단서
LEAD_VOICE = {
    'guitar': dict(partials=(1, .6, .35, .2, .1), attack=0.004, decay=2.4),
    'piano': dict(partials=(1, .5, .25, .125), attack=0.008, decay=1.4),
    'strings': dict(partials=(1, .55, .4, .25, .15), attack=0.09, decay=0.25),
    'synth': dict(partials=(1, .5, .33, .25, .2), attack=0.012, decay=0.6),
}
PRO_TRACKS = ('lead', 'piano', 'synth', 'bass')
PRO_LANES = ('kick', 'snare', 'hat', 'clap')


def _audible(pro: dict) -> dict:
    """믹서: 솔로가 하나라도 있으면 솔로만, 아니면 뮤트 뺀 전부 → {트랙: 크기}"""
    mix = pro.get('mix') or {}
    solo = any((mix.get(t) or {}).get('solo') for t in (*PRO_TRACKS, 'drums'))
    out = {}
    for t in (*PRO_TRACKS, 'drums'):
        m = mix.get(t) or {}
        on = m.get('solo') if solo else not m.get('mute')
        out[t] = float(m.get('vol', 0.8)) / 0.8 if on else 0.0   # 기본 0.8 = 1배
    return out


def _vel_tone(f: float, dur: float, amp: float, vel: int, voice: dict) -> np.ndarray:
    """세기 → 크기 + 밝기 (세게 칠수록 높은 배음이 더 살아요)"""
    v = max(1, min(127, int(vel))) / 127
    bright = 0.45 + 0.55 * v
    parts = tuple(a * (bright ** k) for k, a in enumerate(voice['partials']))
    return tone(f, dur, amp * (0.25 + 0.75 * v), attack=voice['attack'], decay=voice['decay'], partials=parts)


def _render_pro(buf: np.ndarray, guide: dict, pro: dict, beat: float, melody_gain: float, drums: bool, rng: np.random.Generator) -> set:
    """pro 트랙 · 드럼을 buf 에 더하고, 직접 채운 파트 이름을 돌려줘요 (나머지는 예전 방식으로 채움)"""
    bars = len(guide.get('chords') or [1])
    vol = _audible(pro)
    # v3: 잘게 찍은 원래 값(fine · 한 박 = res 틱)이 있으면 그걸로 연주해요
    res = pro.get('res') if pro.get('res') in (1, 2, 4) and isinstance(pro.get('fine'), dict) else 1
    tracks = (pro.get('fine') if res > 1 else pro.get('tracks')) or {}
    done = set()
    spec = {
        'lead': (0.42 * melody_gain, LEAD_VOICE.get(pro.get('lead'), LEAD_VOICE['guitar'])),
        'piano': (0.26, dict(partials=(1, .5, .25, .125), attack=0.008, decay=1.2)),
        'synth': (0.16, dict(partials=(1, .45, .3, .2), attack=0.12, decay=0.2)),
        'bass': (0.32, dict(partials=(1, .4, .1), attack=0.01, decay=1.6)),
    }
    for t in PRO_TRACKS:
        notes = tracks.get(t) or []
        if not notes:
            continue
        done.add(t)   # 찍어 둔 트랙은 뮤트여도 '내가 정한 파트' → 예전 방식으로 채우지 않아요
        amp, voice = spec[t]
        amp *= vol[t]
        if amp <= 0:
            continue
        for n in notes:
            s, m, ln = n['s'], n['m'], n['l']
            if not 0 <= s < bars * 4 * res:
                continue
            _add(buf, _vel_tone(hz(m), ln / res * beat * 0.98, amp, n['v'], voice), int(s / res * beat * SR))
    pattern = pro.get('drum') or {}
    if any(any(pattern.get(l) or []) for l in PRO_LANES):
        done.add('drums')
        g = vol['drums'] if drums else 0.0
        if g > 0:
            six = beat / 4
            swing = float(pro.get('swing') or 0)
            make = {
                'kick': lambda a: kick(a),
                'snare': lambda a: snare(a, rng),
                'hat': lambda a: hat(a, rng),
                'clap': lambda a: clap(a, rng),
            }
            level = {'kick': 0.30, 'snare': 0.16, 'hat': 0.05, 'clap': 0.12}
            for bar in range(bars):
                base = bar * 4 * beat
                for lane in PRO_LANES:
                    for i, v in enumerate((pattern.get(lane) or [])[:16]):
                        if v <= 0:
                            continue
                        at = base + i * six + (swing * six * 0.33 if i % 2 else 0)   # 앱 미리듣기와 같은 스윙
                        _add(buf, make[lane](level[lane] * g * (0.2 + 0.8 * v / 127)), int(at * SR))
    return done


def render_bars(guide: dict, melody_gain: float = 1.0, drums: bool = True, seed: int = 7) -> np.ndarray:
    """가이드 한 바퀴 (코드 수만큼 마디)"""
    bpm = float(guide.get('bpm') or 100)
    beat = 60.0 / bpm
    chords = guide.get('chords') or ['C', 'G', 'Am', 'F']
    bars = len(chords)
    key = _pc(guide.get('key') or 'C')
    n = int(bars * 4 * beat * SR)
    buf = np.zeros(n)
    rng = np.random.default_rng(seed)
    pro = guide.get('pro')
    done = _render_pro(buf, guide, pro, beat, melody_gain, drums, rng) if pro else set()
    for i, c in enumerate(chords):
        r, iv = parse_chord(c)
        start = int(i * 4 * beat * SR)
        # 코드: 가운데 음역 패드 + 베이스 근음 (1 · 3박)
        mids = [hz(48 + ((r + v) % 12) + (12 if (r + v) % 12 < 5 else 0)) for v in iv]
        if not done & {'piano', 'synth'}:
            _add(buf, pad(mids, 4 * beat, 0.22), start)
        if 'bass' not in done:
            for b in (0, 2):
                _add(buf, tone(hz(36 + r), beat * 1.8, 0.30, attack=0.01, decay=1.6, partials=(1, .4, .1)), start + int(b * beat * SR))
        if drums and 'drums' not in done:
            for b in range(4):
                _add(buf, kick(0.22 if b % 2 == 0 else 0.12), start + int(b * beat * SR))
                _add(buf, hat(0.035, rng), start + int((b + 0.5) * beat * SR))
    for note in ([] if pro else guide.get('notes') or []):   # pro 면 리드 트랙이 멜로디 (반음 · 세기까지)
        b0 = float(note.get('beat', 0))
        ln = max(0.25, float(note.get('len', 1)))
        p = int(note.get('pitch', 0))
        if not 0 <= b0 < bars * 4 or not 0 <= p < len(MAJOR):
            continue
        midi = 60 + key + MAJOR[p]
        _add(buf, tone(hz(midi), ln * beat * 0.98, 0.42 * melody_gain, decay=1.4), int(b0 * beat * SR))
    return buf


def _lowpass(x: np.ndarray, hz: float = 2000.0, taps: int = 255) -> np.ndarray:
    """저역 통과 (윈도 싱크 FIR · numpy 만) → 벽 너머 피아노처럼 부드럽게, 2kHz 위 전자음 성분을 깎아요"""
    t = np.arange(taps) - (taps - 1) / 2
    h = np.sinc(2 * hz / SR * t) * np.hamming(taps)
    h /= h.sum()
    return np.convolve(x, h, mode='same')


def render(guide: dict, seconds: float, melody_gain: float = 1.0, melody_where: str = 'all', lowpass: bool = False) -> np.ndarray:
    """곡 길이만큼 반복: 인트로(코드만) → 멜로디 반복 · 16마디마다 4마디 간주(멜로디 작게) → 끝 페이드
    melody_gain: 보컬곡은 0.7 (멜로디 신스가 너무 크면 가사 대신 '뚜루루' 로 따라 불러요 · 2026-11-01 실험)"""
    drums = guide.get('drums', True) is not False
    full = render_bars(guide, melody_gain, drums)
    soft = render_bars(guide, 0.25 * melody_gain, drums)
    bare = render_bars(guide, 0.0, drums)
    loop_len = len(full)
    total = int(seconds * SR)
    out = np.zeros(total)
    i = 0
    pos = 0
    while pos < total:
        if melody_where == 'gaps':
            # 보컬곡용: 멜로디는 전주(첫 바퀴) · 간주(4바퀴마다)에만, 노래 구간은 코드만 → 보컬이 신스 질감을 따라 하지 않게
            part = full if i == 0 or i % 4 == 0 else bare
        else:
            part = bare if i == 0 else (soft if i % 4 == 0 else full)   # 4바퀴(16마디)마다 한 바퀴는 간주
        _add(out, part, pos)
        pos += loop_len
        i += 1
    fade = min(total, int(4 * SR))
    out[-fade:] *= np.linspace(1, 0, fade)
    if lowpass:
        out = _lowpass(out)
    peak = np.max(np.abs(out)) or 1.0
    return out / peak * 0.85


def check(guide: dict) -> dict:
    """앱에서 온 값 확인 → 깨끗한 가이드 (이상하면 ValueError)"""
    if not isinstance(guide, dict):
        raise ValueError('guide 가 없어요')
    bpm = guide.get('bpm')
    if not isinstance(bpm, (int, float)) or not 60 <= bpm <= 180:
        raise ValueError('guide.bpm 은 60~180')
    key = str(guide.get('key') or 'C')
    if key not in NAMES and key not in ALIAS:
        raise ValueError('guide.key 를 모르겠어요')
    chords = guide.get('chords')
    if not isinstance(chords, list) or not 1 <= len(chords) <= 8:
        raise ValueError('guide.chords 는 1~8개')
    out_chords = []
    for c in chords:
        c = str(c).strip()
        root = c[:2] if len(c) > 1 and c[1] in '#b' else c[:1]
        if not root or (root not in NAMES and root not in ALIAS) or len(c) > 8:
            raise ValueError(f'코드를 모르겠어요: {c[:8]}')
        out_chords.append(c)
    notes = guide.get('notes') or []
    if not isinstance(notes, list) or len(notes) > 128:
        raise ValueError('guide.notes 는 128개까지')
    out_notes = []
    for n in notes:
        if not isinstance(n, dict):
            continue
        b, p, ln = n.get('beat'), n.get('pitch'), n.get('len', 1)
        if not all(isinstance(v, (int, float)) for v in (b, p, ln)):
            continue
        if 0 <= b < len(out_chords) * 4 and 0 <= p < len(MAJOR) and 0.25 <= ln <= 8:
            out_notes.append({'beat': float(b), 'pitch': int(p), 'len': float(ln)})
    out = {'bpm': float(bpm), 'key': key, 'chords': out_chords, 'notes': out_notes, 'drums': guide.get('drums', True) is not False}
    pro = check_pro(guide.get('pro'), len(out_chords))
    if pro:
        out['pro'] = pro
    return out


def _num(x, lo: float, hi: float, default: float) -> float:
    if isinstance(x, bool) or not isinstance(x, (int, float)) or x != x:
        return default
    return float(min(hi, max(lo, x)))


def check_pro(v, bars: int) -> dict | None:
    """시퀀서 v2 · v3 값 확인 (서버 checkPro 와 같은 규칙) · 이상한 음은 빼고, 형식이 아예 다르면 None (예전 방식으로)"""
    if not isinstance(v, dict):
        return None
    def notes_of(raw_tracks, steps):
        total = 0
        tracks = {}
        raw_tracks = raw_tracks if isinstance(raw_tracks, dict) else {}
        for t in PRO_TRACKS:
            raw = raw_tracks.get(t) if isinstance(raw_tracks.get(t), list) else []
            out = []
            for n in raw:
                if total >= 256:
                    break
                if not isinstance(n, dict):
                    continue
                s, m = n.get('s'), n.get('m')
                if not all(isinstance(x, int) and not isinstance(x, bool) for x in (s, m)) or not 0 <= s < steps or not 24 <= m <= 108:
                    continue
                out.append({'s': s, 'm': m, 'l': int(round(_num(n.get('l'), 1, steps - s, 1))), 'v': int(round(_num(n.get('v'), 1, 127, 100)))})
                total += 1
            tracks[t] = out
        return tracks
    tracks = notes_of(v.get('tracks'), bars * 4)
    # v3 (서버가 보낸 fine · res): 한 박 = res 틱
    res = v.get('res') if v.get('res') in (2, 4) and isinstance(v.get('fine'), dict) else 1
    fine = notes_of(v.get('fine'), bars * 4 * res) if res > 1 else None
    raw_drum = v.get('drum') if isinstance(v.get('drum'), dict) else {}
    drum = {}
    for l in PRO_LANES:
        raw = raw_drum.get(l) if isinstance(raw_drum.get(l), list) else []
        drum[l] = [int(round(_num(raw[i] if i < len(raw) else 0, 0, 127, 0))) for i in range(16)]
    raw_mix = v.get('mix') if isinstance(v.get('mix'), dict) else {}
    mix = {}
    for t in (*PRO_TRACKS, 'drums'):
        m = raw_mix.get(t) if isinstance(raw_mix.get(t), dict) else {}
        mix[t] = {'vol': _num(m.get('vol'), 0, 1, 0.8), 'mute': m.get('mute') is True, 'solo': m.get('solo') is True}
    lead = v.get('lead') if v.get('lead') in LEAD_VOICE else 'guitar'
    out = {'tracks': tracks, 'drum': drum, 'lead': lead, 'mix': mix, 'swing': _num(v.get('swing'), 0, 1, 0)}
    if fine is not None:
        out.update(res=res, fine=fine)
    return out


def to_wav_bytes(x: np.ndarray) -> bytes:
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    b = io.BytesIO()
    with wave.open(b, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm)
    return b.getvalue()


# 실험용 기본 가이드: C → G → Am → F, '도-미-솔-라-솔~' 로 시작하는 4마디
DEMO = {
    'bpm': 100,
    'key': 'C',
    'chords': ['C', 'G', 'Am', 'F'],
    'notes': [
        {'beat': 0, 'pitch': 0, 'len': 1}, {'beat': 1, 'pitch': 2, 'len': 1}, {'beat': 2, 'pitch': 4, 'len': 1}, {'beat': 3, 'pitch': 5, 'len': 1},
        {'beat': 4, 'pitch': 4, 'len': 2}, {'beat': 6, 'pitch': 2, 'len': 1}, {'beat': 7, 'pitch': 1, 'len': 1},
        {'beat': 8, 'pitch': 0, 'len': 1}, {'beat': 9, 'pitch': 2, 'len': 1}, {'beat': 10, 'pitch': 5, 'len': 2},
        {'beat': 12, 'pitch': 4, 'len': 1}, {'beat': 13, 'pitch': 3, 'len': 1}, {'beat': 14, 'pitch': 2, 'len': 1}, {'beat': 15, 'pitch': 1, 'len': 1},
    ],
}

# 시퀀서 v2 데모: 리드(반음 · 세기) + 피아노 코드 + 베이스 + 16분 드럼 + 스윙
DEMO_PRO = {
    **DEMO,
    'pro': {
        'tracks': {
            'lead': [{'s': 0, 'm': 64, 'l': 1, 'v': 110}, {'s': 1, 'm': 66, 'l': 1, 'v': 60}, {'s': 2, 'm': 67, 'l': 2, 'v': 120},
                     {'s': 6, 'm': 71, 'l': 2, 'v': 90}, {'s': 8, 'm': 69, 'l': 3, 'v': 100}, {'s': 12, 'm': 65, 'l': 4, 'v': 70}],
            'piano': [{'s': b * 4, 'm': m, 'l': 4, 'v': 80} for b, ch in enumerate(([60, 64, 67], [59, 62, 67], [57, 60, 64], [57, 60, 65])) for m in ch],
            'synth': [],
            'bass': [{'s': b * 4 + o, 'm': r, 'l': 1, 'v': 100 if o == 0 else 70} for b, r in enumerate((36, 43, 45, 41)) for o in (0, 2, 3)],
        },
        'drum': {
            'kick': [120, 0, 0, 0, 0, 0, 0, 0, 120, 0, 90, 0, 0, 0, 0, 0],
            'snare': [0, 0, 0, 0, 110, 0, 0, 0, 0, 0, 0, 0, 110, 0, 0, 40],
            'hat': [90, 40, 70, 40] * 4,
            'clap': [0] * 12 + [80, 0, 0, 0],
        },
        'lead': 'synth',
        'mix': {'drums': {'vol': 0.7, 'mute': False, 'solo': False}},
        'swing': 0.5,
    },
}

if __name__ == '__main__':
    import sys
    secs = float(sys.argv[2]) if len(sys.argv) > 2 else 60
    with open(sys.argv[1] if len(sys.argv) > 1 else 'guide.wav', 'wb') as f:
        f.write(to_wav_bytes(render(check(DEMO_PRO if '--pro' in sys.argv else DEMO), secs)))
