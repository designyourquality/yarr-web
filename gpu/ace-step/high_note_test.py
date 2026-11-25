"""high_note.py 확인 (합성 목소리 · numpy)  →  python high_note_test.py"""
import numpy as np

import high_note as hn

SR = hn.SR


def hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def sing(notes, vib=0.25, seed=0) -> np.ndarray:
    """notes = [(MIDI 또는 None(쉼), 초, 크기)] → 배음 + 비브라토가 있는 목소리 비슷한 소리"""
    rng = np.random.default_rng(seed)
    out, ph = [], 0.0
    for m, sec, amp in notes:
        n = int(sec * SR)
        if m is None:
            out.append(rng.standard_normal(n) * 1e-4)
            continue
        t = np.arange(n) / SR
        f = hz(m) * 2 ** (vib * np.sin(2 * np.pi * 5.5 * t) / 12)
        p = ph + 2 * np.pi * np.cumsum(f) / SR
        ph = p[-1]
        y = sum(np.sin(k * p) / k ** 1.3 for k in range(1, 7))
        env = np.minimum(1, np.minimum(t, sec - t) / 0.02)
        out.append(amp * 0.2 * y * env + rng.standard_normal(n) * 1e-3)
    return np.concatenate(out).astype(np.float32)


VERSE = [(64, 0.6, 0.5), (66, 0.5, 0.5), (67, 0.7, 0.5), (None, 0.3, 0), (69, 0.6, 0.6), (67, 0.5, 0.5), (66, 0.8, 0.5), (None, 0.4, 0)] * 3


def test_top_and_hold():
    # 여자: 마지막에 F#5(78)를 2.8초
    r = hn.measure(sing(VERSE + [(74, 0.5, 0.8), (76, 0.5, 0.9), (78, 2.8, 1.0), (None, 0.5, 0)]), 'f')
    assert r['top'] == 'F#5' and abs(r['hold'] - 2.8) < 0.15 and r['cracks'] == 0, r
    assert r['parts']['height'] == 35 and r['parts']['hold'] == 25 and r['parts']['clean'] == 25 and r['lift_db'] > 3, r
    print('여자 F#5 2.8초:', r['score'], r['parts'])
    # 같은 곡인데 꼭대기가 D5(74) 0.6초 → 점수가 훨씬 낮아요
    r2 = hn.measure(sing(VERSE + [(72, 0.5, 0.6), (74, 0.6, 0.6), (None, 0.5, 0)]), 'f')
    assert r2['top'] == 'D5' and r2['score'] < r['score'] - 40, r2
    # 잠깐(0.15초) 스친 높은 음은 꼭대기가 아니에요
    r3 = hn.measure(sing(VERSE + [(74, 1.0, 0.8), (81, 0.15, 0.8), (74, 1.0, 0.8)]), 'f')
    assert r3['top'] == 'D5', r3


def test_male_scale():
    g4 = hn.measure(sing([(m - 12 if m else None, s, a) for m, s, a in VERSE] + [(64, 0.5, 0.8), (67, 2.0, 1.0)]), 'm')
    a4 = hn.measure(sing([(m - 12 if m else None, s, a) for m, s, a in VERSE] + [(64, 0.5, 0.8), (69, 2.0, 1.0)]), 'm')
    assert g4['top'] == 'G4' and a4['top'] == 'A4' and a4['parts']['height'] == 35 and 20 < g4['parts']['height'] < 30, (g4, a4)
    print('남자 G4:', g4['score'], '· A4:', a4['score'])


def test_cracks():
    clean = sing(VERSE + [(76, 1.2, 1.0), (78, 2.0, 1.0)])
    # 삑 1: E5 를 끌다가 0.1초 동안 위로 뒤집혔다 돌아옴 · 삑 2: F#5 를 끌다 0.08초 뒤집히고 끊김
    bad = sing(VERSE + [(76, 0.6, 1.0), (83, 0.1, 0.7), (76, 0.6, 1.0), (78, 1.9, 1.0), (86, 0.08, 0.7), (None, 0.5, 0)], vib=0.1)
    a, b = hn.measure(clean, 'f'), hn.measure(bad, 'f')
    assert a['cracks'] == 0, a
    assert b['cracks'] == 2 and b['parts']['clean'] == 5, b
    assert b['score'] < a['score']
    print('깨끗한 테이크', a['score'], '· 삑사리 2번', b['score'], b['crack_at'])
    # 낮은 음에서 음을 크게 건너뛰는 멜로디(도약)는 삑사리가 아니에요
    leap = sing([(60, 0.5, 0.5), (67, 0.5, 0.5), (60, 0.5, 0.5), (72, 0.5, 0.5)] * 4 + [(79, 2.0, 1.0)])
    assert hn.measure(leap, 'f')['cracks'] == 0
    # 자음 때문에 같은 높은 음이 잠깐씩 끊기는 것도 삑사리가 아니에요
    syll = sing(VERSE + [(78, 0.4, 1.0), (None, 0.06, 0)] * 5 + [(78, 1.5, 1.0)])
    assert hn.measure(syll, 'f')['cracks'] == 0


def test_no_voice():
    r = hn.measure((np.random.default_rng(1).standard_normal(SR * 10) * 1e-3).astype(np.float32), 'f')
    assert r['score'] is None, r


if __name__ == '__main__':
    test_top_and_hold(); test_male_scale(); test_cracks(); test_no_voice()
    print('OK')
