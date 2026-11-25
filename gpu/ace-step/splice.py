"""구간 끼워 넣기 (2026-11-25 · '다시 부르기를 할 때마다 곡 전체 음량이 줄고 강약이 눌린다')

다시 부르기(repaint)는 모델이 곡 '전체'를 새로 내놓아요. 고른 구간 밖도 다시 풀려 나와서
할 때마다 전체 음량이 약 1.5dB 줄고 강약이 눌렸어요 (3번 연속 -14.3 → -18.6 LUFS).
→ 새로 만든 곡에서는 '고른 구간'만 가져와 원본에 끼워 넣어요. 구간 밖은 원본 소리 그대로예요.

  1) 원본 · 새 곡을 48kHz 스테레오로 풀어요
  2) 구간 바로 앞뒤(원본과 같아야 하는 곳)를 맞대서 어긋난 시간(±50ms)과 음량 차이를 재요
  3) 새 구간을 그만큼 옮기고 음량을 원본에 맞춘 뒤 (±6dB 안에서만), 양 끝을 짧게(기본 60ms) 겹쳐 이어요

ffmpeg + numpy 만 써요 (ACE-Step 가상환경 그대로 · 새로 까는 것 없음).
  사용: python splice.py <원본> <새로 만든 곡> <시작 초> <끝 초> <결과.wav>
  출력: JSON 한 줄 {"gain_db", "lag_ms", "corr", "fade_ms", "start", "end"}
"""
from __future__ import annotations

import json
import subprocess
import sys

import numpy as np

SR = 48000
CTX_SEC = 8.0        # 음량 · 시간 차이를 재는 구간 앞뒤 길이
EDGE_SKIP = 0.25     # 경계에 딱 붙은 곳은 이미 새 소리가 섞여 있을 수 있어 조금 띄워서 재요
MAX_LAG_MS = 50
MAX_GAIN_DB = 6.0
FADE_MS = 60


def decode(path: str) -> np.ndarray:
    """→ (샘플 수, 2) float32"""
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'],
                       capture_output=True, check=False)
    if r.returncode != 0 or len(r.stdout) < 8:
        raise RuntimeError(f'소리를 풀지 못했어요: {r.stderr.decode("utf-8", "replace")[:200]}')
    return np.frombuffer(r.stdout, dtype=np.float32).reshape(-1, 2).copy()


def write_wav(x: np.ndarray, out: str) -> None:
    r = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-', '-c:a', 'pcm_s24le', out],
                       input=np.clip(x, -1.0, 1.0).astype(np.float32).tobytes(), capture_output=True, check=False)
    if r.returncode != 0:
        raise RuntimeError(f'wav 쓰기 실패: {r.stderr.decode("utf-8", "replace")[:200]}')


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x, dtype=np.float64)) + 1e-12)) if len(x) else 0.0


def _context(n: int, s: int, e: int) -> list[tuple[int, int]]:
    """구간 앞뒤에서 원본과 같아야 하는 곳 (샘플 범위)"""
    c, k = int(CTX_SEC * SR), int(EDGE_SKIP * SR)
    out = []
    if s - k > SR // 2:
        out.append((max(0, s - k - c), s - k))
    if n - (e + k) > SR // 2:
        out.append((e + k, min(n, e + k + c)))
    return out


def find_lag(orig: np.ndarray, gen: np.ndarray, ctx: list[tuple[int, int]]) -> tuple[int, float]:
    """새 곡이 원본보다 몇 샘플 늦는지 (+ 면 늦어요) · 맞댄 정도(0~1)"""
    if not ctx:
        return 0, 0.0
    dec = 6                                   # 8kHz 로 줄여 빠르게 찾고, 마지막에 48kHz 로 다듬어요
    L = int(MAX_LAG_MS / 1000 * SR)
    mo, mg = orig.mean(1), gen.mean(1)

    def score(lag: int, step: int) -> float:
        num = den_a = den_b = 0.0
        for a, b in ctx:
            a2, b2 = max(a, -lag, 0), min(b, len(mg) - lag, len(mo))
            if b2 - a2 < SR // 4:
                continue
            x, y = mo[a2:b2:step], mg[a2 + lag:b2 + lag:step]
            num += float(np.dot(x, y)); den_a += float(np.dot(x, x)); den_b += float(np.dot(y, y))
        return num / (np.sqrt(den_a * den_b) + 1e-12)

    best, lag = -2.0, 0
    for k in range(-L, L + 1, dec):
        v = score(k, dec)
        if v > best:
            best, lag = v, k
    for k in range(lag - dec, lag + dec + 1):
        v = score(k, 1)
        if v > best:
            best, lag = v, k
    return int(lag), float(max(0.0, best))


def splice_arrays(orig: np.ndarray, gen: np.ndarray, start: float, end: float, fade_ms: int = FADE_MS) -> tuple[np.ndarray, dict]:
    n = len(orig)
    s, e = max(0, int(round(start * SR))), min(n, int(round(end * SR)))
    if e - s < SR:
        raise ValueError('끼워 넣을 구간이 너무 짧아요')
    ctx = _context(n, s, e)
    lag, corr = find_lag(orig, gen, ctx)
    if corr < 0.3:        # 앞뒤가 원본과 안 닮았으면 시간 맞추기를 믿지 않아요
        lag = 0
    # 새 곡을 원본 시간에 맞춰요 (모자란 곳은 0)
    g = np.zeros_like(orig)
    a, b = max(0, -lag), min(n, len(gen) - lag)
    if b > a:
        g[a:b] = gen[a + lag:b + lag]
    # 음량: 구간 앞뒤에서 원본 / 새 곡
    ro = np.sqrt(sum(_rms(orig[x:y]) ** 2 * (y - x) for x, y in ctx) / max(1, sum(y - x for x, y in ctx))) if ctx else 0.0
    rg = np.sqrt(sum(_rms(g[x:y]) ** 2 * (y - x) for x, y in ctx) / max(1, sum(y - x for x, y in ctx))) if ctx else 0.0
    gain_db = 20 * np.log10(ro / rg) if ro > 1e-5 and rg > 1e-5 else 0.0
    gain_db = float(max(-MAX_GAIN_DB, min(MAX_GAIN_DB, gain_db)))
    g *= 10 ** (gain_db / 20)
    # 가장 큰 순간이 원본보다 커져 찢어지지 않게
    peak = float(np.max(np.abs(g[s:e]))) if e > s else 0.0
    if peak > 0.98:
        g *= 0.98 / peak
        gain_db += 20 * np.log10(0.98 / peak)
    # 겹쳐 잇기: 경계를 가운데 두고 fade_ms 동안 (앞뒤 소리가 닮았으면 직선 · 다르면 같은 세기로)
    h = max(1, int(fade_ms / 1000 * SR / 2))
    w = np.zeros(n, dtype=np.float32)
    w[s:e] = 1.0
    eq_power = corr < 0.5
    for edge, up in ((s, True), (e, False)):
        a, b = max(0, edge - h), min(n, edge + h)
        if edge <= 0 or edge >= n or b - a < 2:      # 곡의 맨 앞 · 맨 끝은 겹칠 것이 없어요
            continue
        r = np.linspace(0.0, 1.0, b - a, dtype=np.float32)
        w[a:b] = r if up else 1.0 - r
    wo = 1.0 - w
    if eq_power:
        mid = (w > 0) & (w < 1)
        wn = w.copy()
        wn[mid] = np.sin(w[mid] * np.pi / 2)
        wo[mid] = np.cos(w[mid] * np.pi / 2)
        w = wn
    out = orig * wo[:, None] + g * w[:, None]
    info = {'gain_db': round(float(gain_db), 2), 'lag_ms': round(lag / SR * 1000, 2), 'corr': round(corr, 3),
            'fade_ms': fade_ms, 'start': round(s / SR, 2), 'end': round(e / SR, 2)}
    return out, info


def splice(orig_path: str, gen_path: str, start: float, end: float, out_wav: str) -> dict:
    out, info = splice_arrays(decode(orig_path), decode(gen_path), start, end)
    write_wav(out, out_wav)
    return info


if __name__ == '__main__':
    print(json.dumps(splice(sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), sys.argv[5])))
