"""고음 점수 (2026-11-25 · 발라드 고음 곡의 테이크 2개 중 '고음이 잘 나온 쪽'을 먼저 추천)

목소리만 뽑은 소리(Demucs vocals.wav)에서 음 높이를 따라가며 네 가지를 재요.
  top   꼭대기 음: 0.4초 넘게 안정되게 낸 음 중 가장 높은 음 (잠깐 스친 음 · 추적 실수는 빼요)
  hold  버틴 시간: 꼭대기 음(반음 2개 안)을 가장 길게 끈 시간(초)
  crack 튀는 소리(삑사리): 높은 음을 끌다가 소리가 갑자기 위로 뒤집혔다 돌아온 횟수 (반음 3개 이상 · 0.2초 안)
  lift  음량: 꼭대기 음을 낼 때 목소리가 곡 평소보다 얼마나 큰지(dB)
점수(0~100) = 높이 35 + 버팀 25 + 깨끗함 25 + 음량 15
  높이: 여자 D5(0점) ~ F#5(만점) · 남자 D4(0점) ~ A4(만점)   ← 2026-11-25 측정(여자 F#5~A5 · 남자 G장조 F#4~G4)에 맞춘 첫 기준
  버팀: 0.5초(0점) ~ 2.5초(만점) · 깨끗함: 삑사리 1번에 -10 · 음량: +0dB(0점) ~ +6dB(만점)
※ 진성 · 가성은 가리지 않아요 (배음 비교로는 믿을 만하지 않았어요 · 대표님 귀로 판단).
※ 기준 숫자는 실제 테이크 몇 곡을 대표님 귀와 맞대 보고 다듬어야 해요.

ffmpeg + numpy 만 써요.
  사용: python high_note.py <vocals.wav> <f|m>
  출력: JSON 한 줄 {"score", "top", "top_midi", "top_at", "hold", "cracks", "crack_at", "lift_db", "parts": {...}, "voiced_s"}
"""
from __future__ import annotations

import json
import subprocess
import sys

import numpy as np

SR = 32000
WIN = 2048            # 64ms
HOP = 320             # 10ms
FMIN, FMAX = 110.0, 1200.0
YIN_OK = 0.2          # 이보다 낮으면 '음이 있다'
STABLE_ST = 0.5       # 이웃 프레임 차이가 이 반음 안이면 같은 음을 끄는 중
TOP_MIN_S = 0.4
NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
HEIGHT = {'f': (74.0, 78.0), 'm': (62.0, 69.0)}   # (0점, 만점) MIDI: 여자 D5~F#5 · 남자 D4~A4


def pcm(path: str) -> np.ndarray:
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                       capture_output=True, check=False)
    return np.frombuffer(r.stdout, dtype=np.float32)


def note_name(midi: float) -> str:
    n = int(round(midi))
    return f'{NAMES[n % 12]}{n // 12 - 1}'


def track(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """YIN 으로 10ms 마다 음 높이 → (MIDI 음 · 음이 없으면 nan, 프레임 크기 dB)"""
    n = (len(x) - WIN) // HOP + 1
    if n < 10:
        return np.full(0, np.nan), np.full(0, -120.0)
    tmin, tmax = int(SR / FMAX), int(SR / FMIN)
    midi = np.full(n, np.nan)
    level = np.full(n, -120.0)
    taus = np.arange(1, tmax + 1)
    for c0 in range(0, n, 2000):                      # 메모리를 아끼려고 20초씩
        c1 = min(n, c0 + 2000)
        idx = (np.arange(c0, c1) * HOP)[:, None] + np.arange(WIN)[None, :]
        fr = x[idx].astype(np.float64)
        level[c0:c1] = 10 * np.log10((fr ** 2).mean(1) + 1e-12)
        sp = np.fft.rfft(fr, 2 * WIN, axis=1)
        acf = np.fft.irfft(sp * np.conj(sp), axis=1)[:, : tmax + 1]
        cs = np.concatenate([np.zeros((len(fr), 1)), np.cumsum(fr ** 2, axis=1)], axis=1)
        # d(τ) = Σ x[j]² (0..W-τ) + Σ x[j+τ]² − 2·acf(τ)
        d = cs[:, WIN - taus] + (cs[:, [WIN]] - cs[:, taus]) - 2 * acf[:, 1:]
        d = np.maximum(d, 0)
        cmnd = d * taus / (np.cumsum(d, axis=1) + 1e-12)
        for k in range(len(fr)):
            row = cmnd[k]
            seg = row[tmin - 1:]
            below = np.where(seg < YIN_OK)[0]
            if not len(below):
                continue
            j = below[0]
            while j + 1 < len(seg) and seg[j + 1] < seg[j]:   # 그 골짜기의 바닥까지
                j += 1
            t = j + tmin - 1                                   # row 인덱스 (τ = t + 1)
            if 0 < t < len(row) - 1:
                a, b, c = row[t - 1], row[t], row[t + 1]
                den = a - 2 * b + c
                off = 0.5 * (a - c) / den if abs(den) > 1e-12 else 0.0
            else:
                off = 0.0
            f0 = SR / (t + 1 + off)
            if FMIN <= f0 <= FMAX:
                midi[c0 + k] = 69 + 12 * np.log2(f0 / 440.0)
    quiet = level < (np.nanmax(level) - 40)                    # 분리하고 남은 잔소리는 버려요
    midi[quiet] = np.nan
    return midi, level


def segments(midi: np.ndarray, min_frames: int) -> list[tuple[int, int]]:
    """같은 음을 끄는 구간 [시작, 끝) (프레임)"""
    out, s = [], None
    for i in range(len(midi)):
        ok = np.isfinite(midi[i])
        if ok and s is not None and abs(midi[i] - midi[i - 1]) < STABLE_ST:
            continue
        if s is not None and i - s >= min_frames:
            out.append((s, i))
        s = i if ok else None
    if s is not None and len(midi) - s >= min_frames:
        out.append((s, len(midi)))
    return out


def cracks(midi: np.ndarray, high_from: float) -> list[float]:
    """삑사리 시간(초) 목록 · 높은 음(high_from 이상)을 끌던 중에만 세요
    끌던 음(0.25초 이상) 바로 뒤에, 반음 3개 넘게 높은 소리가 0.2초 안쪽으로 잠깐 났다가
    원래 음으로 돌아오거나 소리가 끊기면 삑사리로 봐요 (목소리가 뒤집히는 소리).
    자음 때문에 같은 음이 잠깐 끊기는 것은 정상이라 세지 않아요."""
    runs = segments(midi, 5)                                   # 50ms 보다 짧은 조각은 음이 바뀌는 순간의 추적 흔들림이라 빼요
    med = [float(np.median(midi[a:b])) for a, b in runs]
    at: list[float] = []
    gap = 8                                                    # 80ms 안이면 '바로 뒤'
    for k in range(1, len(runs)):
        (pa, pb), (ra, rb) = runs[k - 1], runs[k]
        if pb - pa < 25 or med[k - 1] < high_from or ra - pb > gap:
            continue
        if not (rb - ra <= 20 and 3.0 <= med[k] - med[k - 1] <= 14.0):
            continue
        nxt = runs[k + 1] if k + 1 < len(runs) else None
        back = nxt is not None and nxt[0] - rb <= gap and abs(med[k + 1] - med[k - 1]) < 1.5
        stop = nxt is None or nxt[0] - rb >= 15
        if (back or stop) and (not at or ra * HOP / SR - at[-1] > 0.25):
            at.append(round(ra * HOP / SR, 2))
    return at


def _ramp(v: float, lo: float, hi: float) -> float:
    return float(min(1.0, max(0.0, (v - lo) / (hi - lo))))


def measure(x: np.ndarray, sex: str = 'f') -> dict:
    midi, level = track(x)
    voiced = np.isfinite(midi)
    if voiced.sum() < 300:
        return {'score': None, 'error': 'too little voice', 'voiced_s': round(float(voiced.sum()) * HOP / SR, 1)}
    segs = segments(midi, int(TOP_MIN_S * SR / HOP))
    if not segs:
        return {'score': None, 'error': 'no held note', 'voiced_s': round(float(voiced.sum()) * HOP / SR, 1)}
    meds = np.array([float(np.median(midi[a:b])) for a, b in segs])
    # 추적이 한 옥타브 위로 튄 구간은 꼭대기로 치지 않아요: 끈 음들의 위 5% 높이에서 반음 7개 넘게 떨어진 것은 빼요
    durs = np.array([b - a for a, b in segs], dtype=float)
    order = np.argsort(meds)
    cum = np.cumsum(durs[order]) / durs.sum()
    p95 = meds[order][min(len(order) - 1, int(np.searchsorted(cum, 0.95)))]
    keep = meds <= p95 + 7
    top = float(meds[keep].max())
    near = [(a, b) for (a, b), m, k in zip(segs, meds, keep) if k and m >= top - 2.0]
    la, lb = max(near, key=lambda s: s[1] - s[0])
    hold = (lb - la) * HOP / SR
    ta, tb = max(((a, b) for (a, b), m, k in zip(segs, meds, keep) if k and m >= top - 0.5), key=lambda s: s[1] - s[0])
    crack_at = cracks(midi, top - 7.0)
    sung = level[voiced]
    hi = np.concatenate([level[a:b] for a, b in near])
    lift = float(np.median(hi) - np.median(sung))
    lo_m, hi_m = HEIGHT.get(sex, HEIGHT['f'])
    parts = {'height': round(35 * _ramp(top, lo_m, hi_m), 1), 'hold': round(25 * _ramp(hold, 0.5, 2.5), 1),
             'clean': float(max(0, 25 - 10 * len(crack_at))), 'level': round(15 * _ramp(lift, 0.0, 6.0), 1)}
    return {'score': round(sum(parts.values()), 1), 'top': note_name(top), 'top_midi': round(top, 2),
            'top_at': round(ta * HOP / SR, 1), 'hold': round(hold, 2), 'cracks': len(crack_at), 'crack_at': crack_at[:8],
            'lift_db': round(lift, 1), 'parts': parts, 'voiced_s': round(float(voiced.sum()) * HOP / SR, 1), 'sex': sex, 'v': 1}


def check(path: str, sex: str = 'f') -> dict:
    return measure(pcm(path), sex)


if __name__ == '__main__':
    print(json.dumps(check(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'f'), ensure_ascii=False))
