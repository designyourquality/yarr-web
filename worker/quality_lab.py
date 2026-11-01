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
ONLY = os.environ.get('LAB_ONLY', 'all').strip()   # all · t (글로 만든 곡만) · c (직접 찍기만) · v (목소리 노브 7곡) · k (노브 확인 18곡)

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


# ---- 목소리 노브 실험 (LAB_ONLY=v · 2026-11-01): 성별 · 창법 뼈대는 고정, 굵기 · 숨 · 거침 · 파워 '슬롯' 단어만 갈아 끼워요
VOICE_BASE = 'warm korean acoustic pop, piano, acoustic guitar, soft bass, light drums, 90 bpm, female vocal, clean pop style'
VOICE_TAIL = 'natural human vocal, acoustic warmth, studio condenser mic, clear korean pronunciation'
VOICE_MID = {'weight': 'natural mid-range vocal, balanced tone', 'air': 'clean clear tone', 'power': 'moderate relaxed delivery'}
VOICE_LYRICS = """[Verse]
작은 창문 너머로 노을이 번지면
하루 끝에 남은 말을 꺼내 볼게
따뜻한 차 한 잔에 기대어 앉아
오늘도 잘 버텼다고 말해 줄게

[Chorus]
천천히 걸어도 괜찮아
네 걸음은 네가 정하면 돼
저 노을이 다 질 때까지
여기서 같이 쉬어 가자

[Verse]
바쁘게 지나간 사람들 사이로
나만 멈춘 것 같아 겁이 났지만
작은 불빛 하나 켜 둔 이 방에서
다시 숨을 고르는 법을 배워

[Chorus]
천천히 걸어도 괜찮아
네 걸음은 네가 정하면 돼
저 노을이 다 질 때까지
여기서 같이 쉬어 가자"""


def voice_caption(**slots: str) -> str:
    s = {**VOICE_MID, **slots}
    return ', '.join([VOICE_BASE, s['weight'], s['air'], s['power'], VOICE_TAIL])


def voice_plan() -> list[dict]:
    base = {'lyrics': VOICE_LYRICS, 'instrumental': False, 'vocal_language': 'ko', 'bpm': 90, 'duration': SECONDS, 'seed': SEED,
            'shift': 3.0, 'master': True}
    return [
        {'key': 'v1 기준점 (전부 50)', 'input': {**base, 'caption': voice_caption()}},
        {'key': 'v2 굵기 0', 'input': {**base, 'caption': voice_caption(weight='thin high-pitched vocal, light airy head voice, youthful bright timbre')}},
        {'key': 'v3 굵기 100', 'input': {**base, 'caption': voice_caption(weight='deep resonant low-register vocal, thick heavy chest voice, dark warm timbre')}},
        {'key': 'v4 숨소리 100', 'input': {**base, 'caption': voice_caption(air='very breathy whispery vocal, intimate close-mic air, soft sighing delivery')}},
        {'key': 'v5 거침 100', 'input': {**base, 'caption': voice_caption(air='husky raspy vocal, smoky gravelly texture, raw scratchy soul voice')}},
        {'key': 'v6 파워 0', 'input': {**base, 'caption': voice_caption(power='laid-back effortless singing, soft relaxed murmur, low energy vocal')}},
        {'key': 'v7 파워 100', 'input': {**base, 'caption': voice_caption(power='powerful belting vocal, strong emotional projection, high-energy dynamic singing')}},
    ]


# ---- 노브 확인 실험 (LAB_ONLY=k): 굵기 · 숨소리 각각 3단계 × 시드 3개 = 18곡 · 조는 C Major 로 고정 (조가 달라 굵기처럼 들리는 착시 방지)
# 파일: 굵기_1_A.mp3 … 같은 '노브_시드' 묶음 3곡을 서로 비교해 순서를 매겨요 (A·B·C 는 묶음마다 섞여요)
KNOB_LEVELS = {
    '굵기': {'weight': ['thin high-pitched vocal, light airy head voice, youthful bright timbre',
                       VOICE_MID['weight'],
                       'deep warm contralto, mature lower-pitched female voice, rich chest tone']},
    '숨소리': {'air': ['crisp clear tone, no breathiness, firm focused diction',
                      'lightly breathy tone',
                      'very breathy whispery vocal, intimate close-mic air, soft sighing delivery']},
}
KNOB_SEEDS = [11, 22, 33]


def knob_plan() -> list[dict]:
    jobs = []
    base = {'lyrics': VOICE_LYRICS, 'instrumental': False, 'vocal_language': 'ko', 'bpm': 90, 'duration': SECONDS,
            'shift': 3.0, 'master': True, 'keyscale': 'C Major'}
    for knob, slots in KNOB_LEVELS.items():
        slot, words = next(iter(slots.items()))
        for si, seed in enumerate(KNOB_SEEDS, start=1):
            for lv, w in zip((0, 50, 100), words):
                jobs.append({'key': f'{knob} {lv} (시드 {seed})', 'group': f'{knob}_{si}', 'level': lv,
                             'input': {**base, 'seed': seed, 'caption': voice_caption(**{slot: w})}})
    return jobs


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
    jobs = knob_plan() if ONLY == 'k' else voice_plan() if ONLY == 'v' else [j for j in plan() if ONLY in ('', 'all') or j['key'].startswith(ONLY)]
    rnd = random.Random(int(time.time()))
    if ONLY == 'k':
        # 묶음(노브_시드)마다 A · B · C 를 섞어요 → 묶음 안에서 순서 맞히기
        for g in sorted({j['group'] for j in jobs}):
            abc = ['A', 'B', 'C']
            rnd.shuffle(abc)
            for j, x in zip([j for j in jobs if j['group'] == g], abc):
                j['file'] = f"{g}_{x}"
    else:
        letters = [chr(ord('A') + i) for i in range(len(jobs))]
        rnd.shuffle(letters)   # 블라인드: 실행마다 글자가 섞여요
        for j, letter in zip(jobs, letters):
            j['file'] = letter
    for j in jobs:
        letter = j['file']
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
                j['result'] = {k: o.get(k) for k in ('seconds', 'took', 'task', 'dit', 'shift', 'steps', 'master', 'keyscale')}
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
