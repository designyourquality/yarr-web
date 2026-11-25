"""splice.py 확인 (합성 소리 · ffmpeg + numpy)  →  python splice_test.py"""
import os
import subprocess
import tempfile

import numpy as np

import splice as sp

SR = sp.SR


def song(sec: float, seed: int) -> np.ndarray:
    """강약이 있는 '곡 비슷한' 소리: 화음 + 박자 + 뒤로 갈수록 커지는 세기"""
    rng = np.random.default_rng(seed)
    t = np.arange(int(sec * SR)) / SR
    x = sum(np.sin(2 * np.pi * f * t + rng.uniform(0, 6)) / (i + 2) for i, f in enumerate((110, 220, 277, 330, 440, 660)))
    beat = (np.exp(-((t * 2) % 1) * 8))[:, None] * rng.standard_normal((len(t), 2)) * 0.3
    dyn = (0.25 + 0.75 * np.clip(t / sec, 0, 1))[:, None]
    y = (np.stack([x, x * 0.9], 1) * 0.12 + beat * 0.1) * dyn
    return y.astype(np.float32)


def db(a: np.ndarray, b: np.ndarray) -> float:
    return 20 * np.log10(sp._rms(a) / sp._rms(b))


def lufs(x: np.ndarray) -> float:
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, 'a.wav'); sp.write_wav(x, p)
        r = subprocess.run(['ffmpeg', '-nostats', '-i', p, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True)
        tail = r.stderr[r.stderr.rfind('Summary:'):]
        return float(tail.split('I:')[1].split('LUFS')[0])


def fake_repaint(orig: np.ndarray, s: float, e: float, seed: int, drop_db=-1.5, lag_ms=7.0) -> np.ndarray:
    """모델 흉내: 전체가 1.5dB 작아지고 강약이 눌리고 7ms 늦어지고, 고른 구간은 다른 소리"""
    g = orig.copy()
    a, b = int(s * SR), int(e * SR)
    new = song(e - s + 60, seed)[-(b - a):]                  # 강약이 거의 평평한 뒷부분만 (구간 음량을 원본 구간과 같게)
    g[a:b] = new * (sp._rms(orig[a:b]) / sp._rms(new))
    env = np.sqrt(np.convolve((g ** 2).mean(1), np.ones(SR // 2) / (SR // 2), 'same') + 1e-9)
    g = g * ((env / env.mean()) ** -0.35)[:, None]           # 강약 누르기
    g = g * 10 ** (drop_db / 20)
    k = int(lag_ms / 1000 * SR)
    return np.concatenate([np.zeros((k, 2), np.float32), g])[: len(orig)].astype(np.float32)


def test_once_and_three_times():
    orig = song(40, 1)
    cur = orig
    for i, (s, e) in enumerate(((12.0, 19.0), (22.0, 27.0), (30.0, 36.0))):
        gen = fake_repaint(cur, s, e, 10 + i)
        out, info = sp.splice_arrays(cur, gen, s, e)
        a, b = int(s * SR), int(e * SR)
        h = int(0.03 * SR) + 1
        # 구간 밖은 그대로
        assert np.array_equal(out[: a - h], cur[: a - h]) and np.array_equal(out[b + h:], cur[b + h:]), '구간 밖이 바뀌었어요'
        # 구간 안은 새 소리 (원본과 달라요)
        assert not np.allclose(out[a + h:b - h], cur[a + h:b - h], atol=1e-3)
        assert abs(info['lag_ms'] - 7.0) < 0.2, info
        assert info['corr'] > 0.9, info
        # 구간 안의 음량이 앞뒤 원본과 이어져요 (안 맞추면 -1.5dB 아래)
        assert info['gain_db'] > 0.5, info
        # 이음매에 튀는 소리 없음: 경계 앞뒤 5ms 의 가장 큰 샘플 차이가 곡 평소보다 크지 않아요
        dmax = np.abs(np.diff(cur.mean(1))).max()
        for edge in (a, b):
            seg = out[edge - h - 240: edge + h + 240].mean(1)
            assert np.abs(np.diff(seg)).max() < dmax * 1.5, '이음매가 튀어요'
        cur = out
    # 세 번 고쳐도 전체 음량이 그대로 (예전 방식은 -4.5dB)
    old = orig
    for i, (s, e) in enumerate(((12.0, 19.0), (22.0, 27.0), (30.0, 36.0))):
        old = fake_repaint(old, s, e, 10 + i, lag_ms=0)
    d_new, d_old = lufs(cur) - lufs(orig), lufs(old) - lufs(orig)
    print(f'세 번 고친 뒤 전체 음량 변화: 끼워 넣기 {d_new:+.2f} LU · 예전 방식 {d_old:+.2f} LU')
    assert abs(d_new) < 0.5 and d_old < -3.0


def test_edges_and_fallbacks():
    orig = song(30, 2)
    # 곡 맨 앞부터 고치기 · 맨 끝까지 고치기
    for s, e in ((0.0, 6.0), (24.0, 30.0)):
        out, info = sp.splice_arrays(orig, fake_repaint(orig, s, e, 5), s, e)
        assert len(out) == len(orig) and np.isfinite(out).all()
    # 새 곡이 짧게 나와도 길이는 원본대로
    gen = fake_repaint(orig, 10, 15, 6)[: 20 * SR]
    out, _ = sp.splice_arrays(orig, gen, 10, 15)
    assert len(out) == len(orig) and np.array_equal(out[16 * SR:], orig[16 * SR:])
    # 전혀 다른 소리가 와도(앞뒤가 안 닮음) 시간은 건드리지 않고, 6dB 넘게 키우지 않고, 찢어지지 않아요
    out, info = sp.splice_arrays(orig, (np.random.default_rng(9).standard_normal((30 * SR, 2)) * 0.5).astype(np.float32), 10, 15)
    assert info['lag_ms'] == 0 and info['gain_db'] <= 6.01 and np.abs(out).max() <= 1.0, info
    # 너무 짧은 구간은 거절
    try:
        sp.splice_arrays(orig, orig, 10, 10.5)
        raise AssertionError('짧은 구간을 받아 줬어요')
    except ValueError:
        pass


def test_files_mp3():
    """실제 흐름: 원본 mp3 + 새 wav → 끼워 넣은 wav"""
    orig = song(30, 3)
    with tempfile.TemporaryDirectory() as d:
        ow, om, gw, res = (os.path.join(d, n) for n in ('o.wav', 'o.mp3', 'g.wav', 'r.wav'))
        sp.write_wav(orig, ow)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', ow, '-codec:a', 'libmp3lame', '-b:a', '192k', om], check=True)
        o2 = sp.decode(om)
        sp.write_wav(fake_repaint(o2, 8, 14, 7), gw)
        info = sp.splice(om, gw, 8, 14, res)
        r = sp.decode(res)
        assert abs(len(r) - len(o2)) <= 2
        assert abs(db(r[: 7 * SR], o2[: 7 * SR])) < 0.05 and abs(db(r[15 * SR: 29 * SR], o2[15 * SR: 29 * SR])) < 0.05
        assert abs(info['lag_ms'] - 7.0) < 0.3, info
        print('mp3 흐름:', info)


if __name__ == '__main__':
    test_once_and_three_times(); test_edges_and_fallbacks(); test_files_mp3()
    print('OK')
