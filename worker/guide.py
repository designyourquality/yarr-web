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
  "key": "C"                                      # 음계 기준 (도의 위치) · 기본 C
}
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


def _add(buf: np.ndarray, x: np.ndarray, at: int) -> None:
    if at >= len(buf):
        return
    end = min(len(buf), at + len(x))
    buf[at:end] += x[: end - at]


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
    for i, c in enumerate(chords):
        r, iv = parse_chord(c)
        start = int(i * 4 * beat * SR)
        # 코드: 가운데 음역 패드 + 베이스 근음 (1 · 3박)
        mids = [hz(48 + ((r + v) % 12) + (12 if (r + v) % 12 < 5 else 0)) for v in iv]
        _add(buf, pad(mids, 4 * beat, 0.22), start)
        for b in (0, 2):
            _add(buf, tone(hz(36 + r), beat * 1.8, 0.30, attack=0.01, decay=1.6, partials=(1, .4, .1)), start + int(b * beat * SR))
        if drums:
            for b in range(4):
                _add(buf, kick(0.22 if b % 2 == 0 else 0.12), start + int(b * beat * SR))
                _add(buf, hat(0.035, rng), start + int((b + 0.5) * beat * SR))
    for note in guide.get('notes') or []:
        b0 = float(note.get('beat', 0))
        ln = max(0.25, float(note.get('len', 1)))
        p = int(note.get('pitch', 0))
        if not 0 <= b0 < bars * 4 or not 0 <= p < len(MAJOR):
            continue
        midi = 60 + key + MAJOR[p]
        _add(buf, tone(hz(midi), ln * beat * 0.98, 0.42 * melody_gain, decay=1.4), int(b0 * beat * SR))
    return buf


def render(guide: dict, seconds: float) -> np.ndarray:
    """곡 길이만큼 반복: 인트로(코드만) → 멜로디 반복 · 16마디마다 4마디 간주(멜로디 작게) → 끝 페이드"""
    full = render_bars(guide, 1.0)
    soft = render_bars(guide, 0.25)
    bare = render_bars(guide, 0.0)
    loop_len = len(full)
    total = int(seconds * SR)
    out = np.zeros(total)
    i = 0
    pos = 0
    while pos < total:
        part = bare if i == 0 else (soft if i % 4 == 0 else full)   # 4바퀴(16마디)마다 한 바퀴는 간주
        _add(out, part, pos)
        pos += loop_len
        i += 1
    fade = min(total, int(4 * SR))
    out[-fade:] *= np.linspace(1, 0, fade)
    peak = np.max(np.abs(out)) or 1.0
    return out / peak * 0.85


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

if __name__ == '__main__':
    import sys
    secs = float(sys.argv[2]) if len(sys.argv) > 2 else 60
    with open(sys.argv[1] if len(sys.argv) > 1 else 'guide.wav', 'wb') as f:
        f.write(to_wav_bytes(render(DEMO, secs)))
