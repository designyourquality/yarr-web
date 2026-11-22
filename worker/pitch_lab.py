"""YARR 음정 실험 (2026-11-22 · 읽기 전용)

대표님 귀로 '음이 이상하다/괜찮다' 고른 테이크로 음정 검사기를 맞춰 봐요.
  1) demucs 로 목소리만 분리 → 2) pyin 으로 음 높이(f0) 추적 → 3) 지표 계산
  지표: drift(길게 끄는 음이 70센트 이상 처짐/뜸 · 분당 횟수) · offkey(반음 격자에서 35센트 넘게 벗어난 시간 비율)
        outscale(곡 키(장/단조) 밖 음 비율) · wobble(안정 음 안 흔들림 표준편차)
DB 에는 아무것도 쓰지 않아요. 결과는 Artifacts 'pitch-lab' (pitch.json) 와 로그 표.
  사용: PITCH_SET="b:<batch>:<take>|g:<batch>:<take>|g:track:<track id>" python worker/pitch_lab.py
"""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np


def sb():
    from supabase import create_client
    return create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SECRET_KEY'])


def fetch(c, spec):
    """spec = '<b|g>:<batch>:<take>' (스튜디오 테이크) 또는 '<b|g>:track:<track id>' (등록된 곡)"""
    _, a, b = spec.split(':')
    if a == 'track':
        r = c.table('tracks').select('id,title,audio_url').eq('id', b).single().execute().data
        url = r['audio_url']
        assert url.startswith('storage:uploads/'), url[:30]
        return r['title'], c.storage.from_('uploads').download(url[len('storage:uploads/'):])
    r = (c.table('studio_makes').select('id,title,take,storage_path').eq('batch_id', a)
         .eq('take', int(b)).single().execute().data)
    p = r['storage_path']
    bucket, path = ('uploads', p) if not p.startswith('storage:') else p[len('storage:'):].split('/', 1)
    return f"{r['title']} t{b}", c.storage.from_(bucket).download(path)


SCALES = {'major': [0, 2, 4, 5, 7, 9, 11], 'minor': [0, 2, 3, 5, 7, 8, 10]}


def analyse(wav: str, acc: str | None = None) -> dict:
    import librosa
    y, sr = librosa.load(wav, sr=16000, mono=True)
    hop = 160  # 10ms
    f0, vflag, vprob = librosa.pyin(y, fmin=80, fmax=900, sr=sr, frame_length=1024, hop_length=hop)
    ok = vflag & (vprob > 0.5) & np.isfinite(f0)
    midi = np.full_like(f0, np.nan)
    midi[ok] = librosa.hz_to_midi(f0[ok])
    v = midi[ok]
    if v.size < 300:
        return {'voiced_s': round(v.size * 0.01, 1), 'error': 'too little voice'}
    # 곡 전체 튜닝 어긋남(센트)을 먼저 빼요
    frac = (v - np.round(v))
    tune = float(np.angle(np.mean(np.exp(2j * np.pi * frac))) / (2 * np.pi))
    m = midi - tune
    # 안정 음 구간: 연속 유성 프레임에서 이웃 차이 < 0.35 반음 이 15프레임(150ms) 이상
    segs, cur = [], []
    for i in range(len(m)):
        if np.isfinite(m[i]) and (not cur or abs(m[i] - m[cur[-1]]) < 0.35):
            cur.append(i)
        else:
            if len(cur) >= 15:
                segs.append(cur)
            cur = [i] if np.isfinite(m[i]) else []
    if len(cur) >= 15:
        segs.append(cur)
    dur_min = len(y) / sr / 60
    drift, wob, dev, pcs = 0, [], [], np.zeros(12)
    for s in segs:
        x = m[s]
        # 끄는 음(300ms 이상) 앞 1/3 과 뒤 1/3 중앙값 차이
        if len(s) >= 30:
            k = len(s) // 3
            if abs(np.median(x[-k:]) - np.median(x[:k])) >= 0.7:
                drift += 1
        wob.append(float(np.std(x - np.median(x))))
        med = float(np.median(x))
        dev.append((abs(med - round(med)), len(s)))
        pcs[int(round(med)) % 12] += len(s)
    tot = sum(n for _, n in dev) or 1
    offkey = sum(n for d, n in dev if d > 0.35) / tot
    best = None
    for root in range(12):
        for name, sc in SCALES.items():
            inside = sum(pcs[(root + i) % 12] for i in sc)
            if best is None or inside > best[0]:
                best = (inside, root, name)
    outscale = 1 - best[0] / (pcs.sum() or 1)
    # 반주와 부딪힘: 안정 음(200ms+)의 음이름이 그 순간 반주 크로마에서 약하고, 반음 옆이 강하면 '충돌'
    clash_t, clash_n, clash_at = 0, 0, []
    if acc:
        ya, _ = librosa.load(acc, sr=16000, mono=True)
        ch = librosa.feature.chroma_cqt(y=ya, sr=sr, hop_length=hop * 4)  # 40ms
        for sgm in segs:
            if len(sgm) < 20:
                continue
            a0, a1 = sgm[0] // 4, max(sgm[0] // 4 + 1, sgm[-1] // 4)
            c = ch[:, a0:a1].mean(axis=1)
            c = c / (c.max() + 1e-9)
            pc = int(round(float(np.median(m[sgm])))) % 12
            if c[pc] < 0.25 and max(c[(pc + 1) % 12], c[(pc - 1) % 12]) > 0.7:
                clash_t += len(sgm)
                clash_n += 1
                clash_at.append(round(sgm[0] * 0.01, 1))
    return {'clash': round(clash_t / tot, 3), 'clash_per_min': round(clash_n / dur_min, 2), 'clash_at': clash_at[:12],'voiced_s': round(v.size * 0.01, 1), 'tune_cents': round(tune * 100), 'notes': len(segs),
            'drift_per_min': round(drift / dur_min, 2), 'offkey': round(offkey, 3), 'outscale': round(float(outscale), 3),
            'wobble': round(float(np.median(wob)) if wob else 0, 3),
            'key': ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][best[1]] + ' ' + best[2]}


def main() -> None:
    c = sb()
    specs = [s.strip() for s in os.environ.get('PITCH_SET', '').split('|') if s.strip()]
    out = []
    for spec in specs:
        label = spec.split(':')[0]
        rec = {'label': {'b': '이상', 'g': '괜찮음'}.get(label, '?'), 'spec': spec}
        try:
            title, data = fetch(c, spec)
            rec['title'] = title
            with tempfile.TemporaryDirectory() as tmp:
                src = os.path.join(tmp, 'a.mp3')
                open(src, 'wb').write(data)
                subprocess.run([sys.executable, '-m', 'demucs', '--two-stems=vocals', '-n', 'htdemucs', '-o', tmp, src],
                               check=True, capture_output=True)
                voc = os.path.join(tmp, 'htdemucs', 'a', 'vocals.wav')
                rec.update(analyse(voc, os.path.join(tmp, 'htdemucs', 'a', 'no_vocals.wav')))
        except Exception as e:  # noqa: BLE001
            rec['error'] = str(e)[:200]
        print(f"[{rec['label']}] {rec.get('title', spec)[:24]:<24} drift/분 {rec.get('drift_per_min')} · offkey {rec.get('offkey')} · "
              f"outscale {rec.get('outscale')} · 충돌 {rec.get('clash')} ({rec.get('clash_per_min')}/분 @{rec.get('clash_at')}) · wobble {rec.get('wobble')} · 튜닝 {rec.get('tune_cents')}c · {rec.get('key')} {rec.get('error', '')}", flush=True)
        out.append(rec)
    os.makedirs('pitch_out', exist_ok=True)
    json.dump(out, open('pitch_out/pitch.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for k in ('drift_per_min', 'offkey', 'outscale', 'wobble', 'clash', 'clash_per_min'):
        b = [r[k] for r in out if r['label'] == '이상' and k in r]
        g = [r[k] for r in out if r['label'] == '괜찮음' and k in r]
        if b and g:
            print(f"== {k}: 이상 평균 {np.mean(b):.3f} (최소 {min(b)}) · 괜찮음 평균 {np.mean(g):.3f} (최대 {max(g)})", flush=True)


if __name__ == '__main__':
    main()
