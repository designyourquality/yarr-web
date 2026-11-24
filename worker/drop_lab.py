"""YARR 끝음 처짐 실험 (2026-11-24 · 읽기 전용 · DB 에 쓰지 않아요)

대표님이 귀로 짚은 '끝음이 이상하게 내려간다' 테이크(b)와 괜찮은 테이크(g)로
'문구 끝 0.3초' 처짐 검출기를 맞춰요.
  1) demucs 로 목소리만 분리 → 2) pyin 음 높이(10ms) → 3) 문구(소리 나는 덩어리) 끝마다
     끝 0.3초 음 높이 중앙값 - 바로 앞 0.55초 중앙값 (센트) → 처짐
  사용: DROP_SET="b:<batch>:<take>@13,28|g:<batch>:<take>|..." python worker/drop_lab.py
        @ 뒤 숫자는 대표님이 들은 위치(초) · 맞혔는지(±1.5초) 같이 봐요
결과: 로그 표 + drop.json (Artifacts 'drop-lab') · 가장 잘 가르는 기준(문구 끝 처짐 비율 · 깊이) 추천
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


def fetch(c, a, b):
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


def vocals(src: str, tmp: str) -> str:
    subprocess.run([sys.executable, '-m', 'demucs', '--two-stems', 'vocals', '-n', 'htdemucs', '-o', tmp, src],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = os.path.splitext(os.path.basename(src))[0]
    return os.path.join(tmp, 'htdemucs', base, 'vocals.wav')


def phrase_ends(ok: np.ndarray, min_len=40, gap_fill=8, rest=20):
    """소리 나는 덩어리(10ms 단위): 8칸(80ms) 이하 끊김은 이어 보고, 0.4초 이상 · 뒤에 0.2초 이상 쉼이 있는 끝"""
    v = ok.copy()
    i = 0
    n = len(v)
    while i < n:
        if not v[i]:
            j = i
            while j < n and not v[j]:
                j += 1
            if 0 < i and j < n and j - i <= gap_fill:
                v[i:j] = True
            i = j
        else:
            i += 1
    out = []
    i = 0
    while i < n:
        if v[i]:
            j = i
            while j < n and v[j]:
                j += 1
            k = j
            while k < n and not v[k]:
                k += 1
            if j - i >= min_len and (k - j >= rest or k >= n):
                out.append((i, j))
            i = j
        else:
            i += 1
    return out


def analyse(wav: str) -> dict:
    import librosa
    y, sr = librosa.load(wav, sr=16000, mono=True)
    hop = 160
    f0, vflag, vprob = librosa.pyin(y, fmin=80, fmax=900, sr=sr, frame_length=1024, hop_length=hop)
    ok = vflag & (vprob > 0.5) & np.isfinite(f0)
    midi = np.full_like(f0, np.nan)
    midi[ok] = librosa.hz_to_midi(f0[ok])
    rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=hop)[0][:len(midi)]
    db = 20 * np.log10(rms + 1e-9)
    loud = db > (np.percentile(db[ok], 90) - 30 if ok.any() else -60)
    ok = ok & loud[:len(ok)]
    ends = []
    for a, b in phrase_ends(ok):
        seg = midi[a:b]
        tail = seg[-30:]
        body = seg[-85:-30]
        tail = tail[np.isfinite(tail)]
        body = body[np.isfinite(body)]
        if tail.size < 10 or body.size < 15:
            continue
        drop = float(np.median(tail) - np.median(body)) * 100
        # 마지막 0.15초 기울기 (센트/초) · 끝 음이 반음 격자에서 벗어난 정도
        last = seg[-15:]
        last = last[np.isfinite(last)]
        slope = float(np.polyfit(np.arange(last.size) * 0.01, last, 1)[0] * 100) if last.size >= 6 else 0.0
        off = float(abs(np.median(tail) - np.round(np.median(tail))) * 100)
        ends.append({'t': round(b * 0.01, 1), 'drop': round(drop), 'slope': round(slope), 'off': round(off)})
    dur_min = max(len(y) / sr / 60, 0.1)
    return {'phrases': len(ends), 'ends': ends, 'dur_min': round(dur_min, 2)}


def score(r: dict, thr: float) -> dict:
    d = [e for e in r['ends'] if e['drop'] <= -thr]
    return {'rate': round(len(d) / max(1, r['phrases']), 3), 'per_min': round(len(d) / r['dur_min'], 2),
            'at': [e['t'] for e in sorted(d, key=lambda e: e['drop'])][:10]}


def main() -> None:
    c = sb()
    specs = [s.strip() for s in os.environ.get('DROP_SET', '').split('|') if s.strip()]
    rows = []
    with tempfile.TemporaryDirectory() as tmp:
        for spec in specs:
            head, _, marks = spec.partition('@')
            lab, a, b = head.split(':')
            heard = [float(x) for x in marks.split(',') if x.strip()] if marks else []
            try:
                title, data = fetch(c, a, b)
                src = os.path.join(tmp, f'{a[:8]}_{b}.mp3')
                open(src, 'wb').write(data)
                r = analyse(vocals(src, tmp))
                rows.append({'label': lab, 'title': title, 'spec': head, 'heard': heard, **r})
                print(f'ok {lab} {title} phrases={r["phrases"]}', flush=True)
            except Exception as e:  # noqa: BLE001
                print(f'FAIL {spec}: {e}', flush=True)
    # 기준 찾기: 처짐 깊이(센트) × 비율 문턱 → 이상(b) / 괜찮음(g) 정확도
    best = None
    for thr in (40, 50, 60, 70, 80, 100, 120):
        rates = [(x['label'], score(x, thr)['rate']) for x in rows]
        for cut in sorted({rt for _, rt in rates}):
            acc = sum((lb == 'b') == (rt >= cut) for lb, rt in rates) / max(1, len(rates))
            if best is None or acc > best[0]:
                best = (acc, thr, cut)
    print('\n라벨 | 곡 | 문구 수 | 처짐비율(60c) | 분당 | 처짐 위치(깊은 순) | 들은 위치 맞힘')
    for x in rows:
        s = score(x, best[1] if best else 60)
        hit = sum(any(abs(h - t) <= 1.5 for t in s['at']) for h in x['heard'])
        print(f"{x['label']} | {x['title']} | {x['phrases']} | {s['rate']} | {s['per_min']} | {s['at']} | {hit}/{len(x['heard'])}")
    if best:
        print(f'\n추천 기준: 끝 0.3초가 {best[1]}센트 이상 내려간 문구 비율 >= {best[2]} → 이상 · 정확도 {round(best[0] * 100)}%')
    json.dump({'rows': rows, 'best': best}, open('drop.json', 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
