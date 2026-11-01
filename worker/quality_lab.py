"""음질 실험: '전자음 같은 목소리'를 줄이는 설정 비교 (블라인드 9곡)

GitHub → Actions → 'YARR 음질 실험' → Run workflow (GPU 비용이 드는 실행이라 사람이 눌러요)
필요: Secrets 의 RUNPOD_API_KEY (yarr-ace-step 만 Read/Write)
결과: Artifacts 'quality-lab' → A.mp3 ~ I.mp3 (어떤 설정인지 모르게) + 정답.json (다 들은 뒤에 열어 보기)

글로 만드는 보컬곡 ('오후3시' 가사 · 재즈 · 여자 보컬) 6곡 + 직접 찍기 보컬곡(도미솔라솔 가이드) 3곡
  t1 지금 그대로 (turbo · shift 1)
  t2 shift 3 (공식 문서 권장값)
  t3 shift 3 + 질감 단어 (natural human vocal, breathy …)
  t4 t3 + 마스터링 (쇳소리 -2dB · 중저음 +1.5dB · 가벼운 압축)
  t5 t4 + 12단계
  t6 XL turbo(4B) + t4
  c1 직접 찍기 지금 그대로 (보컬 0.35 · 멜로디 전체)
  c2 shift 3 + 멜로디는 전주 · 간주에만 + 가이드 2kHz 위 깎기 + 질감 단어 + 마스터링
  c3 XL turbo + c2
"""
from __future__ import annotations

import base64
import json
import os
import random
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import guide  # noqa: E402

ENDPOINT = os.environ.get('ACE_ENDPOINT', 'g2lwtq15pm8ocz')
KEY = os.environ.get('RUNPOD_API_KEY', '')
SECONDS = int(os.environ.get('LAB_SECONDS', '120'))
OUT = os.environ.get('LAB_OUT', 'quality_lab_out')
SEED = 1031

TEXTURE = 'natural human vocal, breathy, acoustic warmth, studio condenser mic'
# 2026-11-01 '오후3시' 와 같은 곡 설명 · 가사 (모델에 보낸 모양 그대로)
AFTERNOON = ('jazz trio, piano, upright bass, brushed drums, gradually building arrangement, rising to an uplifting climax, 96 bpm, '
             'sultry smoky female jazz vocal, velvety low tone, relaxed behind-the-beat phrasing, sultry jazz lounge vocal, relaxed swing phrasing, '
             'velvety tone, clear korean pronunciation, female narrator, deep warm speaking voice, gentle close-mic narrative style, '
             'spoken word intro before the singing starts')
AFTERNOON_LYRICS = "[Intro - Spoken Word over Soft Music, No Singing]\n오후 세 시, 창가로 스며드는 햇살과 고소한 커피 향기...\n\n[Verse]\n나무 식탁 위에 올려둔 읽다 만 소설책\n창문 틈으로 불어오는 고소한 커피 향기\n구두 소리는 가볍게 박자를 맞추고\n골목길 모퉁이엔 게으른 고양이 한 마리\n\n[Chorus]\n살랑이는 오후 세 시의 리듬을 타 봐\n내 마음은 벌써 구름 위를 걷는 기분\n아무렴 어때, 오늘 하루쯤은 이렇게\n나른한 재즈 선율에 몸을 맡긴 채\n샤랄라 웃어 보는 거야\n\n[Bridge]\n바쁘게 돌아가는 세상은 잠시 꺼 두고\n설탕 대신 달콤한 멜로디를 저어 볼까\n\n[Chorus]\n살랑이는 오후 세 시의 리듬을 타 봐\n내 마음은 벌써 구름 위를 걷는 기분\n아무렴 어때, 오늘 하루쯤은 이렇게\n나른한 재즈 선율에 몸을 맡긴 채\n샤랄라 웃어 보는 거야\n\n[Outro]"
POP = 'warm korean city pop, electric piano, clean electric guitar, slap bass, soft drums, 100 bpm, C major, bright and nostalgic, clear female vocal, clean korean pronunciation'
POP_LYRICS = """[Verse]
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


def with_texture(caption: str) -> str:
    # 'clear korean pronunciation' 앞에 질감 단어 (모델이 앞쪽 말을 더 따라요)
    return caption.replace('clear korean pronunciation', f'{TEXTURE}, clear korean pronunciation', 1)


def plan() -> list[dict]:
    base = {'caption': AFTERNOON, 'lyrics': AFTERNOON_LYRICS, 'instrumental': False, 'vocal_language': 'ko', 'bpm': 96, 'duration': SECONDS, 'seed': SEED}
    tuned = {**base, 'caption': with_texture(AFTERNOON), 'shift': 3.0, 'master': True}
    cover = {'caption': POP, 'lyrics': POP_LYRICS, 'instrumental': False, 'vocal_language': 'ko', 'bpm': 100, 'duration': 90, 'seed': SEED,
             'guide': guide.DEMO, 'cover_strength': 0.35}
    cover_tuned = {**cover, 'caption': POP.replace('clean korean pronunciation', f'{TEXTURE}, clean korean pronunciation'),
                   'shift': 3.0, 'master': True, 'guide_melody': 'gaps', 'guide_lowpass': True}
    return [
        {'key': 't1 지금 그대로 (turbo · shift 1)', 'input': base},
        {'key': 't2 shift 3', 'input': {**base, 'shift': 3.0}},
        {'key': 't3 shift 3 + 질감 단어', 'input': {**base, 'caption': with_texture(AFTERNOON), 'shift': 3.0}},
        {'key': 't4 t3 + 마스터링', 'input': tuned},
        {'key': 't5 t4 + 12단계', 'input': {**tuned, 'steps': 12}},
        {'key': 't6 XL turbo(4B) + t4', 'input': {**tuned, 'dit': 'acestep-v15-xl-turbo'}},
        {'key': 'c1 직접 찍기 지금 그대로', 'input': cover},
        {'key': 'c2 직접 찍기 shift3 + 멜로디 전주·간주만 + 가이드 고음 깎기 + 질감 + 마스터링', 'input': cover_tuned},
        {'key': 'c3 직접 찍기 XL turbo + c2', 'input': {**cover_tuned, 'dit': 'acestep-v15-xl-turbo'}},
    ]


def call(method: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(f'https://api.runpod.ai/v2/{ENDPOINT}/{path}', method=method,
                                 data=None if body is None else json.dumps(body).encode(),
                                 headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def main() -> None:
    if not KEY:
        sys.exit('RUNPOD_API_KEY 가 없어요')
    os.makedirs(OUT, exist_ok=True)
    jobs = plan()
    letters = [chr(ord('A') + i) for i in range(len(jobs))]
    random.Random(int(time.time())).shuffle(letters)   # 블라인드: 실행마다 글자가 섞여요
    for j, letter in zip(jobs, letters):
        j['file'] = letter
        r = call('POST', 'run', {'input': j['input']})
        j['id'] = r.get('id')
        print('보냄', letter, r.get('id'), flush=True)
    deadline = time.time() + 45 * 60
    pending = list(jobs)
    while pending and time.time() < deadline:
        time.sleep(15)
        for j in list(pending):
            st = call('GET', f"status/{j['id']}")
            s = st.get('status')
            if s == 'COMPLETED':
                o = st.get('output') or {}
                with open(os.path.join(OUT, j['file'] + '.mp3'), 'wb') as f:
                    f.write(base64.b64decode(o.get('audio_b64', '')))
                j['result'] = {k: o.get(k) for k in ('seconds', 'took', 'task', 'dit', 'shift', 'steps', 'master')}
                print('완성', j['file'], j['result'], flush=True)
                pending.remove(j)
            elif s in ('FAILED', 'CANCELLED', 'TIMED_OUT'):
                j['result'] = {'status': s, 'error': str(st.get('error'))[:500]}
                print('실패', j['file'], st.get('error'), flush=True)
                pending.remove(j)
    answer = {j['file']: {'설정': j['key'], **j.get('result', {'status': 'TIMEOUT'})} for j in sorted(jobs, key=lambda x: x['file'])}
    with open(os.path.join(OUT, '정답.json'), 'w', encoding='utf-8') as f:
        json.dump(answer, f, ensure_ascii=False, indent=1)
    ok = sum(1 for j in jobs if (j.get('result') or {}).get('task'))
    print(f'완성 {ok}/{len(jobs)}')
    if ok == 0:
        sys.exit(1)


if __name__ == '__main__':
    main()
