"""코드 타임라인 · 조성(Key) 추정 (numpy 만 · CPU 몇 초)

완성된 오디오(드럼 · 베이스 · 보컬이 섞인 음원)에서
  1) 0.19초마다 12음(크로마)을 재고
  2) 장 · 단 3화음 24개 + '코드 없음'과 비교한 뒤
  3) 코드가 자주 바뀌지 않게 비터비로 다듬어서
  [{"t": 시작 초, "c": "Am"}, …] 와 "C Major" 같은 조성을 돌려줘요.
AI 추정값이라 앱에는 'AI 추정 코드'로 보여 줘요.
v2: 봉우리만 세기 · 패드 덜어내기 · 베이스 가중치 2배 · 바뀜 문턱 낮춤 · BPM 기준 최소 길이.
"""
from __future__ import annotations

import subprocess

import numpy as np

SR = 11025
N_FFT = 4096
HOP = 2048
NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
# Krumhansl–Kessler 조성 프로필
_MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

# 민감도 (v2 · 2026-10-31 · 합성 시험곡 4개 100%: 드럼 · 잔향 · 계속 깔린 패드 · 움직이는 보컬)
PEAK = True     # 잡음(드럼 · 숨소리) 대신 스펙트럼 '봉우리'만 음으로 셈 ← 패드 · 잡음에 코드가 묻히던 문제의 핵심
PEAKX = 4.0     # 봉우리로 칠 크기: 그 순간 중앙값의 몇 배 이상
SLOW = 0.5      # 16초 이동 평균의 이만큼을 빼서, 계속 깔리는 패드 · 보컬 롱톤을 덜어냄
SCALE = 12      # 코드 판정 선명도
STAY = 0.85     # 같은 코드에 머무르려는 정도 (낮을수록 잘 바뀜 · v1 0.92)
BASSW = 0.3     # 베이스(40~260Hz)가 근음이면 가산점 (v1 0.15 → 2배)


def decode(path: str) -> np.ndarray:
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                       capture_output=True, check=False)
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError('오디오를 읽지 못했어요')
    return np.frombuffer(r.stdout, dtype=np.float32).astype(np.float64)


def chroma(x: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(크로마 12×프레임, 저음 크로마 12×프레임, 프레임 에너지)"""
    if len(x) < N_FFT:
        x = np.pad(x, (0, N_FFT - len(x)))
    n = 1 + (len(x) - N_FFT) // HOP
    idx = np.arange(N_FFT)[None, :] + HOP * np.arange(n)[:, None]
    frames = x[idx] * np.hanning(N_FFT)[None, :]
    mag = np.abs(np.fft.rfft(frames, axis=1))
    freqs = np.fft.rfftfreq(N_FFT, 1 / SR)
    pc = np.full(freqs.shape, -1)
    ok = (freqs >= 55) & (freqs <= 2000)
    midi = 69 + 12 * np.log2(np.where(ok, freqs, 440) / 440)
    pc[ok] = np.round(midi[ok]).astype(int) % 12
    bass = (freqs >= 40) & (freqs <= 260)
    pcb = np.full(freqs.shape, -1)
    pcb[bass] = np.round(69 + 12 * np.log2(freqs[bass] / 440)).astype(int) % 12
    lm = np.log1p(mag * 50)   # 에너지(조용한 구간 판정)용
    # 잡음(드럼 · 숨소리) 대신 '음'만: 양옆보다 큰 봉우리이면서 그 프레임 중앙값의 PEAKX 배 이상인 칸만 세요
    if PEAK:
        pk = (mag[:, 1:-1] > mag[:, :-2]) & (mag[:, 1:-1] >= mag[:, 2:])
        pk = np.pad(pk, ((0, 0), (1, 1)))
        med = np.median(mag[:, ok], axis=1, keepdims=True) + 1e-9
        pk &= mag > PEAKX * med
        hm = np.where(pk, np.sqrt(mag), 0.0)
    else:
        hm = lm
    c = np.zeros((12, n))
    b = np.zeros((12, n))
    for k in range(12):
        c[k] = hm[:, pc == k].sum(axis=1)
        b[k] = hm[:, pcb == k].sum(axis=1)
    energy = lm[:, ok].sum(axis=1)
    return c, b, energy


def _templates() -> tuple[np.ndarray, list[str]]:
    t, names = [], []
    for r in range(12):
        for q, iv in (('', (0, 4, 7)), ('m', (0, 3, 7))):
            v = np.zeros(12)
            for i in iv:
                v[(r + i) % 12] = 1.0
            v[r] += 0.5   # 근음을 조금 더
            t.append(v / np.linalg.norm(v))
            names.append(NAMES[r] + q)
    return np.array(t), names


def viterbi(score: np.ndarray, stay: float = 0.92) -> np.ndarray:
    """score: (상태, 프레임) 로그 확률 · 같은 코드에 머무를 확률 stay"""
    s, n = score.shape
    move = np.log((1 - stay) / (s - 1))
    keep = np.log(stay)
    trans = np.full((s, s), move)
    np.fill_diagonal(trans, keep)
    dp = score[:, 0].copy()
    back = np.zeros((s, n), dtype=int)
    for i in range(1, n):
        m = dp[:, None] + trans
        back[:, i] = m.argmax(axis=0)
        dp = m.max(axis=0) + score[:, i]
    path = np.zeros(n, dtype=int)
    path[-1] = int(dp.argmax())
    for i in range(n - 1, 0, -1):
        path[i - 1] = back[path[i], i]
    return path


def estimate_key(c: np.ndarray, chords: list[list] | None = None, total: float = 0.0) -> str:
    """크로마 전체로 조성 후보를 고르고, 나란한조(C Major ↔ A Minor)는 으뜸화음이 더 오래 · 처음 · 끝에 나오는 쪽으로"""
    prof = c.sum(axis=1)
    if prof.sum() <= 0:
        return ''
    best, root, mode = -2.0, 0, 'Major'
    for r in range(12):
        for p, q in ((_MAJ, 'Major'), (_MIN, 'Minor')):
            v = np.corrcoef(prof, np.roll(p, r))[0, 1]
            if v > best:
                best, root, mode = v, r, q
    if chords:
        rel = ((root + 3) % 12, 'Major') if mode == 'Minor' else ((root + 9) % 12, 'Minor')
        def weight(r: int, q: str) -> float:
            name = NAMES[r] + ('' if q == 'Major' else 'm')
            w = 0.0
            for j, (t, lab) in enumerate(chords):
                end = chords[j + 1][0] if j + 1 < len(chords) else total
                if lab == name:
                    w += end - t
            if chords[0][1] == name:
                w += 4
            if chords[-1][1] == name:
                w += 6
            return w
        if weight(*rel) > weight(root, mode):
            root, mode = rel
    return f'{NAMES[root]} {mode}'


def analyze(path: str, bpm: float | None = None) -> dict:
    """{'v': 2, 'key': 'C Major', 'chords': [{'t': 0.0, 'c': 'C'}, …]}
    bpm 을 알면 1박보다 짧은 코드는 앞 코드에 붙여요 (모르면 0.8초)"""
    x = decode(path)
    c, b, energy = chroma(x)
    n = c.shape[1]
    step = HOP / SR
    k = max(1, int(16 / step))
    ker = np.ones(k) / k
    slow = np.vstack([np.convolve(c[i], ker, mode='same') for i in range(12)])
    c2 = np.maximum(c - SLOW * slow, 0) + 1e-9
    tpl, names = _templates()
    feat = c2 / (np.linalg.norm(c2, axis=0, keepdims=True) + 1e-9)
    bassn = b / (np.linalg.norm(b, axis=0, keepdims=True) + 1e-9)
    sim = tpl @ feat
    root = np.repeat(np.arange(12), 2)
    sim = sim + BASSW * bassn[root, :]
    quiet = energy < np.percentile(energy, 5) * 0.6 + 1e-9
    n_score = np.where(quiet, 1.0 + BASSW, 0.55)[None, :]
    allsim = np.vstack([sim, n_score])
    logp = SCALE * allsim
    logp -= logp.max(axis=0, keepdims=True)
    logp -= np.log(np.exp(logp).sum(axis=0, keepdims=True))
    path = viterbi(logp, STAY)
    labels = names + ['N']
    segs = []
    for i, p in enumerate(path):
        if segs and segs[-1][1] == labels[p]:
            continue
        segs.append([i * step, labels[p]])
    total = n * step
    minlen = (60.0 / bpm) if bpm and 40 <= bpm <= 220 else 0.8
    out = []
    for j, (t, lab) in enumerate(segs):
        end = segs[j + 1][0] if j + 1 < len(segs) else total
        if out and (end - t < minlen or out[-1][1] == lab):
            continue
        out.append([t, lab])
    chords = [{'t': round(t, 1), 'c': lab} for t, lab in out][:600]
    return {'v': 2, 'key': estimate_key(c, [x for x in out if x[1] != 'N'], total), 'chords': chords}
