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
ONLY = os.environ.get('LAB_ONLY', 'all').strip()   # all · t (글로 만든 곡만) · c (직접 찍기만) · v (목소리 노브 7곡) · k (노브 확인 18곡) · p (보컬 페르소나 24종 × 2 = 48클립) · r (페르소나 재실험 8종 × 2 = 16클립)

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


# ---- 보컬 페르소나 24종 확인 (LAB_ONLY=p): 성별 · 나이대 · 창법 · 마이크 · 장르 캐릭터를 한 세트로 통째로 바꿔요
# 24종 × 시드 2개 = 48클립 (40초 · 절 2줄 + 후렴 2줄) · 카테고리 폴더 안에서 이름을 가린 채 '어떤 목소리인지' 맞히기
# 키: 기존 house-music VOCAL_TONES 키를 그대로 쓰고(레시피 호환), 새 캐릭터만 새 키 (f_rnb · f_folk · m_ballad · m_band · fx_gugak)
# (key, 카테고리, 화면 이름, 목소리 묘사, 어울리는 반주 힌트, bpm, 이펙트 여부)
PERSONAS = [
    ('f_clear', '여자', '맑고 청아한 소녀 미성', 'bright youthful female soprano, pure crystal-clear head voice, innocent clean pop tone', 'light acoustic pop, piano', 96, False),
    ('f_whisper', '여자', '새벽 감성 · 귓속말 호흡', 'intimate close-mic whispery female vocal, ultra-breathy airy delivery, soft sighing indie-folk tone', 'lo-fi acoustic guitar, soft room', 78, False),
    ('f_mature', '여자', '성숙하고 깊은 중저음 (알토)', 'deep warm female contralto, mature low-register chest voice, rich dark timbre', 'slow piano ballad', 70, False),
    ('f_jazz', '여자', '스모키 재즈 · 허스키 소울', 'smoky raspy female jazz diva, gritty soulful throat texture, warm vintage tube-mic vocal', 'jazz trio, upright bass, brushed drums', 92, False),
    ('f_rnb', '여자', '트렌디 R&B · 그루브', 'stylish K-R&B female vocal, agile melisma and runs, rhythmic groovy delivery', 'smooth R&B groove, electric piano', 94, False),
    ('f_diva', '여자', '폭발적 고음 · 파워 디바', 'powerful belting female diva, soaring high-note climax, strong chest projection', 'big pop ballad, strings, drums', 76, False),
    ('f_folk', '여자', '담백한 이야기꾼 (포크)', 'laid-back conversational female vocal, unadorned natural acoustic singer-songwriter tone', 'fingerpicked acoustic guitar', 88, False),
    ('f_trot', '여자', '간드러지는 정통 트로트', 'expressive korean trot female vocal, rich traditional vibrato, bright nasal inflection', 'korean trot, accordion, two-beat rhythm', 124, False),
    ('m_soft', '남자', '달콤하고 부드러운 미성', 'sweet warm male high-tenor, soft romantic ballad vocal, gentle smooth tone', 'piano ballad, soft strings', 72, False),
    ('m_indie', '남자', '나른한 카페 싱어송라이터', 'relaxed effortless male indie vocal, intimate close-mic breathy murmur', 'bossa nova acoustic guitar', 90, False),
    ('m_deep', '남자', '동굴 같은 묵직한 중저음', 'deep resonant male baritone-bass, thick heavy chest voice, dark commanding low-end', 'slow jazz ballad, upright bass', 68, False),
    ('m_rock', '남자', '거칠고 터프한 록 · 블루스', 'raw gravelly male rock vocal, gritty raspy scratchy throat, aggressive powerful tone', 'blues rock, overdriven electric guitar, drums', 118, False),
    ('m_rap', '남자', '멜로디 싱잉랩 · 트렌디 R&B', 'melodic singing-rap male vocal, rhythmic hip-hop R&B flow, modern trendy delivery', 'hip hop beat, mellow keys', 92, False),
    ('m_ballad', '남자', '애절한 호소력 · 허스키 발라드', 'emotional husky male K-ballad vocal, dramatic raspy climax, deep sorrowful projection', 'rock ballad, piano, strings', 70, False),
    ('m_band', '남자', '시원한 고음 · 청량 밴드 보컬', 'bright energetic male pop-rock tenor, punchy clear high-register projection, uplifting', 'pop rock band, driving drums', 128, False),
    ('m_trot', '남자', '구수하고 힘 있는 성인가요', 'deep resonant korean trot male vocal, heavy traditional vibrato, rich mature projection', 'korean trot, brass, two-beat rhythm', 120, False),
    ('duet', '그룹', '남녀 설레는 어쿠스틱 듀엣', 'male and female vocal duet, alternating verses, sweet harmonized chorus', 'acoustic pop, guitar and piano', 92, False),
    ('group_girl', '그룹', '청량 걸그룹 (다인원 하모니)', 'bright k-pop girl group vocals, multiple female voices, layered catchy chorus harmonies', 'upbeat k-pop, synth, punchy drums', 120, False),
    ('group_boy', '그룹', '에너제틱 보이그룹 (랩 + 보컬)', 'energetic k-pop boy group vocals, male vocal and rap trade-off, powerful unison chorus', 'k-pop dance, heavy beat', 124, False),
    ('choir', '그룹', '웅장한 가스펠 · 콰이어 합창단', 'grand gospel choir vocals, massive multi-part harmony, soulful ensemble singing', 'gospel organ, piano, handclaps', 84, False),
    ('fx_radio', '이펙트', '빈티지 라디오 (전화기 너머)', 'lo-fi vintage AM radio vocal filter, narrow bandpass telephone voice effect, vinyl crackle', 'old-time swing band', 100, True),
    ('fx_autotune', '이펙트', '사이버펑크 오토튠 (기계음)', 'heavy hard-tuned robotic pitch correction, futuristic vocoder electronic vocal', 'dark synthwave, electronic beat', 110, True),
    ('fx_echo', '이펙트', '몽환적 우주 리버브 (드림팝)', 'vocal drenched in massive shimmering cathedral reverb and delay, ethereal shoegaze dream-pop vocal', 'dream pop, washed-out guitars', 86, True),
    ('fx_gugak', '이펙트', '국악 소리꾼 (판소리 한 자락)', 'traditional korean pansori fusion vocal, dramatic han-filled raspy vibrato, powerful projection', 'korean traditional fusion, gayageum, janggu', 96, True),
]
PERSONA_LYRICS = """[Verse]
골목 끝 작은 불빛 하나 켜 두고
오늘의 이야기를 천천히 꺼내 볼게

[Chorus]
이 노래가 너에게 닿을 때까지
나는 여기서 계속 부를게"""
PERSONA_SEEDS = [7, 77]


def persona_plan() -> list[dict]:
    jobs = []
    for key, cat, name, desc, stage, bpm, fx in PERSONAS:
        tail = 'clear korean pronunciation' if fx else 'natural human vocal, acoustic warmth, studio condenser mic, clear korean pronunciation'
        caption = f'{stage}, {bpm} bpm, {desc}, {tail}'
        for seed in PERSONA_SEEDS:
            jobs.append({'key': f'{cat} · {name} ({key}) · 시드 {seed}', 'group': cat, 'persona': key, 'name': name,
                         'input': {'caption': caption, 'lyrics': PERSONA_LYRICS, 'instrumental': False, 'vocal_language': 'ko',
                                   'bpm': bpm, 'duration': 40, 'seed': seed, 'shift': 3.0, 'master': True}})
    return jobs


# ---- 페르소나 재실험 (LAB_ONLY=r · 2026-11-01): p 실험에서 흔들린 8종만 고쳐서 같은 시드(7 · 77)로 다시 뽑아요
# 그룹 4종: 두 번 중 한 번만 캐릭터가 나옴 → 설명 강화 + 가사 섹션 제목에 파트 지시
# 소녀 미성 vs 포크: 둘 다 통기타라 헷갈림 → 반주 · 마이크 질감을 갈라요
# 남자 트로트 · 발라드: 전주 15~24초 → 첫 섹션 제목 + 곡 설명 앞에 '바로 노래 시작'
NO_INTRO = '[Verse 1 - immediate vocal entry, no instrumental intro]'
R_LYRICS = {
    'duet': """[Verse - Male Vocal Solo]
골목 끝 작은 불빛 하나 켜 두고
오늘의 이야기를 천천히 꺼내 볼게

[Chorus - Female Vocal Solo]
이 노래가 너에게 닿을 때까지

[Chorus - Male and Female Duet Harmony]
나는 여기서 계속 부를게""",
    'group': """[Verse - Group Members Trading Lines]
골목 끝 작은 불빛 하나 켜 두고
오늘의 이야기를 천천히 꺼내 볼게

[Chorus - Full Group Unison and Layered Harmony]
이 노래가 너에게 닿을 때까지
나는 여기서 계속 부를게""",
    'no_intro': NO_INTRO + """
골목 끝 작은 불빛 하나 켜 두고
오늘의 이야기를 천천히 꺼내 볼게

[Chorus]
이 노래가 너에게 닿을 때까지
나는 여기서 계속 부를게""",
}
# (key, 폴더, 화면 이름, 곡 설명 전체, bpm, 가사 종류)
RETEST = [
    ('duet', '그룹', '남녀 설레는 어쿠스틱 듀엣', 'romantic acoustic duet, guitar and piano, 92 bpm, male and female vocal duet, distinct male verse and female chorus, two singers trading lines, sweet harmonized ending', 92, 'duet'),
    ('group_girl', '그룹', '청량 걸그룹 (다인원 하모니)', 'cheerful teen-pop band sound, bright guitar, punchy live drums, 120 bpm, natural clean k-pop girl group vocals, multiple bright female voices singing in unison, clean human vocal harmony', 120, 'group'),
    ('group_boy', '그룹', '에너제틱 보이그룹 (랩 + 보컬)', 'k-pop dance, heavy beat, 124 bpm, all-male k-pop boy band, multiple masculine male vocals, deep male rap and punchy male tenor chorus, powerful male unison hook', 124, 'group'),
    ('choir', '그룹', '웅장한 가스펠 · 콰이어 합창단', 'gospel organ, piano, handclaps, 84 bpm, large gospel choir ensemble, twenty singers singing together in unison and four-part harmony, powerful group chorus from the start', 84, 'group'),
    ('f_clear', '여자', '맑고 청아한 소녀 미성', 'bright acoustic piano and bell pop, glockenspiel, 96 bpm, bright youthful female soprano, pure crystal-clear head voice, innocent clean pop tone', 96, 'plain'),
    ('f_folk', '여자', '담백한 이야기꾼 (포크)', 'unplugged fingerstyle acoustic guitar, warm harmonica, no drums, 88 bpm, laid-back conversational female vocal, dry close-mic conversational singing, unadorned singer-songwriter tone', 88, 'plain'),
    ('m_trot', '남자', '구수하고 힘 있는 성인가요', 'immediate vocal start, short intro, korean trot, brass, two-beat rhythm, 120 bpm, deep resonant korean trot male vocal, heavy traditional vibrato, rich mature projection', 120, 'no_intro'),
    ('m_ballad', '남자', '애절한 호소력 · 허스키 발라드', 'immediate vocal start, short intro, rock ballad, piano, strings, 70 bpm, emotional husky male k-ballad vocal, dramatic raspy climax, deep sorrowful projection', 70, 'no_intro'),
]


def retest_plan() -> list[dict]:
    jobs = []
    for key, cat, name, caption, bpm, kind in RETEST:
        fx_tail = 'natural human vocal, acoustic warmth, studio condenser mic, clear korean pronunciation'
        lyrics = R_LYRICS.get(kind, PERSONA_LYRICS)
        for seed in PERSONA_SEEDS:
            jobs.append({'key': f'{cat} · {name} ({key}) · 시드 {seed}', 'group': cat, 'persona': key, 'name': name,
                         'input': {'caption': f'{caption}, {fx_tail}', 'lyrics': lyrics, 'instrumental': False, 'vocal_language': 'ko',
                                   'bpm': bpm, 'duration': 40, 'seed': seed, 'shift': 3.0, 'master': True}})
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
    jobs = persona_plan() if ONLY == 'p' else retest_plan() if ONLY == 'r' else knob_plan() if ONLY == 'k' else voice_plan() if ONLY == 'v' else [j for j in plan() if ONLY in ('', 'all') or j['key'].startswith(ONLY)]
    rnd = random.Random(int(time.time()))
    if ONLY in ('p', 'r'):
        # 카테고리 폴더 안에서 번호를 섞어요 (여자/여자_07.mp3) · 폴더마다 고를 목록(목록.txt)을 같이 넣어요
        for cat in dict.fromkeys(j['group'] for j in jobs):
            mine = [j for j in jobs if j['group'] == cat]
            nums = list(range(1, len(mine) + 1))
            rnd.shuffle(nums)
            for j, n in zip(mine, nums):
                j['file'] = f"{cat}/{cat}_{n:02d}"
            os.makedirs(os.path.join(OUT, cat), exist_ok=True)
            with open(os.path.join(OUT, cat, '목록.txt'), 'w', encoding='utf-8') as f:
                f.write(f'{cat} 클립 {len(mine)}개 · 아래 목소리 중 어떤 것인지 골라 주세요 (목소리마다 2개씩)\n\n')
                names = dict.fromkeys(m['name'] for m in mine)
                f.write('\n'.join(f'- {x}' for x in names) + '\n')
    elif ONLY == 'k':
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
