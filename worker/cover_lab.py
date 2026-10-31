"""직접 찍기 실험: 가이드 음원(C-G-Am-F + 도트 멜로디)을 ACE-Step 커버 모드로 6곡 만들어 들어 보기

GitHub → Actions → 'YARR 커버 실험' → Run workflow (GPU 비용이 드는 실행이라 사람이 눌러요)
필요: 저장소 Secrets 에 RUNPOD_API_KEY (RunPod → Settings → API Keys · 대표님이 직접 넣어요)
결과: 실행 화면 아래 Artifacts 'cover-lab' (guide.mp3 + 6곡 mp3 + results.json)

강도 3단계 × 연주곡 / 보컬곡 = 6곡
  #1~3 연주곡 0.35 / 0.55 / 0.75   #4~6 보컬곡 0.35 / 0.55 / 0.75
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import guide  # noqa: E402

ENDPOINT = os.environ.get('ACE_ENDPOINT', 'g2lwtq15pm8ocz')
KEY = os.environ.get('RUNPOD_API_KEY', '')
SECONDS = float(os.environ.get('LAB_SECONDS', '90'))
STRENGTHS = [float(x) for x in os.environ.get('LAB_STRENGTHS', '0.35,0.55,0.75').split(',') if x.strip()]
OUT = os.environ.get('LAB_OUT', 'cover_lab_out')

CAPTION = 'warm korean city pop, electric piano, clean electric guitar, slap bass, soft drums, 100 bpm, C major, bright and nostalgic'
VOCAL = CAPTION + ', clear female vocal, clean korean pronunciation'
LYRICS = """[Verse]
창밖에 비가 그치면
너에게 걸어갈게

[Chorus]
도 미 솔 라 솔 노래해
오늘 밤 우리 둘이서

[Verse]
불 켜진 골목 끝에서
너를 기다릴게

[Chorus]
도 미 솔 라 솔 노래해
오늘 밤 우리 둘이서"""


def call(method: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(f'https://api.runpod.ai/v2/{ENDPOINT}/{path}', method=method,
                                 data=None if body is None else json.dumps(body).encode(),
                                 headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def main() -> None:
    if not KEY:
        sys.exit('RUNPOD_API_KEY 가 없어요 (GitHub → Settings → Secrets and variables → Actions 에 넣어 주세요)')
    os.makedirs(OUT, exist_ok=True)
    wav = os.path.join(OUT, 'guide.wav')
    with open(wav, 'wb') as f:
        f.write(guide.to_wav_bytes(guide.render(guide.DEMO, SECONDS)))
    mp3 = os.path.join(OUT, 'guide.mp3')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-b:a', '160k', mp3], check=True)
    os.remove(wav)
    src = base64.b64encode(open(mp3, 'rb').read()).decode()
    jobs = []
    n = 0
    for vocal in (False, True):
        for s in STRENGTHS:
            n += 1
            name = f"{n}_{'vocal' if vocal else 'inst'}_{int(s * 100):02d}"
            inp = {'caption': VOCAL if vocal else CAPTION, 'instrumental': not vocal, 'lyrics': LYRICS if vocal else '',
                   'vocal_language': 'ko', 'bpm': 100, 'seed': 1031, 'src_audio_b64': src, 'cover_strength': s}
            r = call('POST', 'run', {'input': inp})
            print('보냄', name, r.get('id'), flush=True)
            jobs.append({'name': name, 'id': r.get('id'), 'strength': s, 'vocal': vocal})
    results = []
    deadline = time.time() + 40 * 60
    pending = list(jobs)
    while pending and time.time() < deadline:
        time.sleep(15)
        for j in list(pending):
            st = call('GET', f"status/{j['id']}")
            status = st.get('status')
            if status == 'COMPLETED':
                o = st.get('output') or {}
                path = os.path.join(OUT, j['name'] + '.mp3')
                with open(path, 'wb') as f:
                    f.write(base64.b64decode(o.get('audio_b64', '')))
                results.append({**j, 'status': status, 'seconds': o.get('seconds'), 'took': o.get('took'), 'task': o.get('task')})
                print('완성', j['name'], o.get('seconds'), '초 ·', o.get('took'), '초 걸림 ·', o.get('task'), flush=True)
                pending.remove(j)
            elif status in ('FAILED', 'CANCELLED', 'TIMED_OUT'):
                results.append({**j, 'status': status, 'error': str(st.get('error'))[:500]})
                print('실패', j['name'], st.get('error'), flush=True)
                pending.remove(j)
    for j in pending:
        results.append({**j, 'status': 'TIMEOUT'})
    with open(os.path.join(OUT, 'results.json'), 'w', encoding='utf-8') as f:
        json.dump({'guide': guide.DEMO, 'caption': CAPTION, 'lyrics': LYRICS, 'results': results}, f, ensure_ascii=False, indent=1)
    ok = sum(1 for r in results if r.get('status') == 'COMPLETED')
    print(f'완성 {ok}/{len(jobs)}')
    if ok == 0:
        sys.exit(1)


if __name__ == '__main__':
    main()
