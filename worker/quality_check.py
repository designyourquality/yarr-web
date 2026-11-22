"""1단계 · 명백한 생성 사고 검사 (2026-11-20)

소리 파형만 보고 '누가 들어도 사고'인 곡을 걸러요. 발음 · 취향 판단은 하지 않아요 (그건 2 · 3단계).
사용자 곡 · 운영팀 곡 모두 이 검사만은 똑같이 적용해요. 걸리면 서버가 무료로 다시 만들어요.

  사용: python quality_check.py <음원> [가사 파일] [받아쓰기 JSON]
  출력: JSON 한 줄 {"ok": bool, "faults": [...], "warns": [...], "m": {측정값}}

검사 항목 (모두 ffmpeg 로 PCM 을 받아 numpy 로 계산 · 곡당 1초 안팎)
  abrupt_end   끝 0.3초가 곡 평균보다 크게 남은 채로 끝남 (페이드 없이 뚝)
  silence_gap  곡 중간(앞 3초 · 끝 6초 제외)에 4초 넘는 무음
  clipping     0 dBFS 에 붙은 샘플이 0.1% 넘음, 또는 길게 붙은 구간이 많음 (찢어지는 소리)
  muffled      고음이 거의 없음 (4~10kHz 에너지가 전체의 -30dB 아래 = 먹먹한 깡통 소리)
  loop_lyric   받아쓰기에서 같은 줄이 3번 넘게 연달아 나오는데, 가사에는 그렇게 쓰여 있지 않음 (도돌이표 버그)
경고(warns) 는 버리지 않고 기록만 해요.
"""
import json
import re
import subprocess
import sys
from difflib import SequenceMatcher

import numpy as np

SR = 22050
ABRUPT_DB = -9.0        # 끝 0.3초 크기가 곡 중앙값보다 이만큼 '덜 작으면' (= -9dB 보다 크면) 뚝 끊김
SILENCE_DBFS = -50.0
SILENCE_SEC = 4.0
CLIP_RATIO = 0.01       # 1% 넘게 0dBFS 에 붙으면 사고 (실측: 정상 곡 최대 0.23%, 일부러 찌그러뜨린 곡 15.7%)
CLIP_RUNS = 3000        # 4샘플 넘게 붙은 구간 수 (정상 곡 최대 444, 망가진 곡 27,102)
CLIP_WARN = 0.001       # 0.1% 넘으면 경고만
MUFFLED_DB = -30.0      # 4~10kHz 에너지 비율 (실측: 정상 28곡 -21.8 ~ -12.7dB, 3kHz 로 자른 곡 -38dB)
LOOP_MIN = 4            # 같은 줄이 이 횟수 이상 연달아


def pcm(path: str) -> np.ndarray:
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                       capture_output=True, check=False)
    return np.frombuffer(r.stdout, dtype=np.float32)


def rms_db(x: np.ndarray, win: int) -> np.ndarray:
    n = len(x) // win
    if n == 0:
        return np.array([-120.0])
    e = np.sqrt((x[: n * win].reshape(n, win) ** 2).mean(1) + 1e-12)
    return 20 * np.log10(e)


def abrupt_end(x: np.ndarray) -> tuple[bool, float]:
    """끝 0.3초 크기 - 곡 중앙값 (dB). 페이드아웃이면 -20dB 아래로 떨어져요"""
    db = rms_db(x, SR // 10)                    # 0.1초 단위
    if len(db) < 50:
        return False, 0.0
    body = np.median(db[: -30])
    tail = float(np.max(db[-3:]))
    d = tail - body
    return d > ABRUPT_DB, round(d, 1)


def silence_gap(x: np.ndarray) -> tuple[bool, float]:
    db = rms_db(x, SR // 10)
    mid = db[30: max(30, len(db) - 60)]          # 앞 3초 · 끝 6초 제외
    longest = run = 0
    for v in mid:
        run = run + 1 if v < SILENCE_DBFS else 0
        longest = max(longest, run)
    sec = longest / 10
    return sec >= SILENCE_SEC, sec


def clipping(x: np.ndarray) -> tuple[bool, float, int]:
    hot = np.abs(x) >= 0.999
    ratio = float(hot.mean()) if len(x) else 0.0
    runs = 0
    if hot.any():
        d = np.diff(np.concatenate([[0], hot.astype(np.int8), [0]]))
        starts, ends = np.where(d == 1)[0], np.where(d == -1)[0]
        runs = int(((ends - starts) > 4).sum())
    return ratio > CLIP_RATIO or runs > CLIP_RUNS, round(ratio * 100, 3), runs


def muffled(x: np.ndarray) -> tuple[bool, float]:
    """소리가 큰 구간만 골라 4~10kHz 에너지 / 0.1~10kHz 에너지 (dB)"""
    win = 4096
    n = len(x) // win
    if n < 20:
        return False, 0.0
    fr = x[: n * win].reshape(n, win)
    loud = np.sqrt((fr ** 2).mean(1))
    fr = fr[loud > np.percentile(loud, 50)]
    sp = (np.abs(np.fft.rfft(fr * np.hanning(win), axis=1)) ** 2).mean(0)
    f = np.fft.rfftfreq(win, 1 / SR)
    hi = sp[(f >= 4000) & (f < 10000)].sum()
    all_ = sp[(f >= 100) & (f < 10000)].sum() + 1e-12
    db = float(10 * np.log10(hi / all_ + 1e-12))
    return db < MUFFLED_DB, round(db, 1)


def _norm(t: str) -> str:
    return re.sub(r'[^0-9a-z가-힣぀-ヿ一-鿿]', '', (t or '').lower())


def _max_consecutive(lines: list[str]) -> tuple[int, str]:
    best, cur, what = 1, 1, ''
    for a, b in zip(lines, lines[1:]):
        same = len(a) >= 4 and SequenceMatcher(None, a, b, autojunk=False).ratio() >= 0.8
        cur = cur + 1 if same else 1
        if cur > best:
            best, what = cur, b
    return best, what


def loop_lyric(heard_lines: list[str], lyrics: str) -> tuple[bool, int, str]:
    """받아쓰기 줄 목록에서 같은 줄이 LOOP_MIN 번 넘게 연달아 · 가사 원문에 그만큼 연달아 있으면 정상"""
    heard = [_norm(h) for h in heard_lines if _norm(h)]
    n, what = _max_consecutive(heard)
    want = [_norm(l) for l in re.sub(r'\[[^\]]*\]', '\n', lyrics or '').split('\n') if _norm(l)]
    n_lyr, _ = _max_consecutive(want) if want else (1, '')
    return n >= LOOP_MIN and n > n_lyr + 1, n, what


def check(path: str, lyrics: str = '', heard_lines: list[str] | None = None) -> dict:
    x = pcm(path)
    if x.size < SR * 5:
        return {'ok': False, 'faults': ['too_short'], 'warns': [], 'm': {'sec': round(x.size / SR, 1)}}
    faults, warns, m = [], [], {'sec': round(x.size / SR, 1)}
    b, end_db = abrupt_end(x)
    m['end_db'] = float(end_db)
    if b:
        faults.append('abrupt_end')
    s, m['silence_sec'] = silence_gap(x)
    if s:
        faults.append('silence_gap')
    c, m['clip_pct'], m['clip_runs'] = clipping(x)
    if c:
        faults.append('clipping')
    elif m['clip_pct'] > CLIP_WARN * 100:
        warns.append('clipping_light')
    mu, m['hf_db'] = muffled(x)
    if mu:
        faults.append('muffled')
    if heard_lines:
        lp, m['loop_n'], what = loop_lyric(heard_lines, lyrics)
        if lp:   # 받아쓰기(whisper)도 스스로 같은 줄을 되풀이하곤 해서 경고만 (2026-11-20 · 나도-댄스2 에서 잘못 걸림)
            warns.append('loop_lyric')
            m['loop_line'] = what[:30]
    return {'ok': not faults, 'faults': faults, 'warns': warns, 'm': m}


if __name__ == '__main__':
    lyr = open(sys.argv[2], encoding='utf-8').read() if len(sys.argv) > 2 else ''
    heard = json.load(open(sys.argv[3], encoding='utf-8')) if len(sys.argv) > 3 else None
    print(json.dumps(check(sys.argv[1], lyr, heard), ensure_ascii=False))
