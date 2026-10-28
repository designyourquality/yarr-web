"""YARR 자동 검수 워커 (GitHub Actions 에서 30분마다 실행)

하는 일
  1. 서버에서 '검수 대기 + 아직 자동 검수 안 한' 곡을 가져와요 (업로드 파일이 있는 곡만).
  2. 원본 파일을 받아 FFmpeg 로 음량(LUFS · 피크)과 길이를 재요.
  3. -14 LUFS (피크 -1 dBTP) 로 맞춘 AAC 파일을 만들어 저장소에 올려요 (승인하면 이 파일이 재생돼요).
  4. ACRCloud 키가 있으면 기존 상업 음원과 3구간을 대조해요. 없으면 '미연결'로 적어요. (YARR 오리지널은 생략)
     YARR 오리지널은 앞 0.5초 · 끝 5초를 페이드 처리해 뚝 끊기지 않게 해요.
  5. YARR 안의 다른 곡과 음원 지문(Chromaprint)을 대조해요 — 남의 곡 · 내가 이미 올린 곡 다시 올리기.
  6. 제목 · 프롬프트 · 가사에 커버 · 원곡 · 스타일 표기, 실존 가수 이름, 해시태그가 있는지 보고 YARR 안 가사 중복도 봐요.
  7. 결과를 tracks 에 적고 (011 SQL 이후) 자동으로 결정해요.
       - 확실한 문제 (기존 곡 일치 · 같은 음원 · 무료 플랜 · 무음 · 60초 미만) → 자동 반려 + 이유
       - 애매함 (커버 · 원곡 · 스타일 표기 · 실존 이름 · 해시태그 · 가사 중복 · 약한 유사 · 15분 초과 · 검수 실패)
         → 대기 (관리자 화면에 주의 단어를 노란색으로)
       - 모두 깨끗하고 ACRCloud 대조까지 통과 → 자동 승인 (다음 0시 공개, 관리자는 공개 전 취소 가능)
       - ACRCloud 가 없으면 자동 승인은 안 함 (AUTO_APPROVE_WITHOUT_ACR=1 이고 믿을 만한 크리에이터면 예외)
  8. 1년 지난 앱 오류 기록을 지워요 (개인정보 처리방침의 보관 기간).

필요한 비밀값 (GitHub → Settings → Secrets and variables → Actions)
  SUPABASE_URL            https://<프로젝트>.supabase.co
  SUPABASE_SECRET_KEY     Supabase → Project Settings → API Keys 의 secret 키 (sb_secret_… 또는 service_role)
  ACR_HOST, ACR_ACCESS_KEY, ACR_ACCESS_SECRET   (선택) ACRCloud 프로젝트 값
  AUTO_DECIDE              (선택) 0 이면 자동 승인 · 반려 끄기 (측정만)
  AUTO_APPROVE_WITHOUT_ACR (선택) 1 이면 ACRCloud 없이도 믿을 만한 크리에이터 곡은 자동 승인

로컬 시험: python worker/review.py --file 노래.mp3   (서버 없이 측정 · 변환만)
"""
from __future__ import annotations

import argparse
import array
import base64
import datetime as dt
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import tempfile
import time

TARGET_I, TARGET_TP, TARGET_LRA = -14.0, -1.0, 11.0
LIMIT_DB = -2.0           # 리미터 상한 (dBFS) · AAC 로 바꿀 때 생기는 피크 여유
BATCH = 10
MIN_PLAY_SEC = 60          # 서버가 유효 재생으로 세는 최소 시간 (이보다 짧으면 차트 · 정산에 안 잡힘)
DUP_REJECT, DUP_HOLD = 0.85, 0.75   # 음원 지문 일치도
ACR_REJECT_SCORE = 80

# 반려 이유 (앱 관리자 콘솔의 반려 버튼과 같은 문장 → 크리에이터 화면에 그대로 보임)
R_COPY = '기존 곡과 유사 (표절 의심)'
R_ARTIST = '실존 아티스트 이름 · 목소리 사용'
R_QUALITY = '음질 불량 (잡음 · 끊김)'
R_LICENSE = '상업 라이선스 증빙 부족'
R_DUP = 'YARR에 이미 있는 곡과 같은 음원'
R_SHORT = '60초보다 짧은 곡 (재생이 집계되지 않아요)'


# ---------------------------------------------------------------- 오디오

def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, check=False)


def duration_sec(path: str) -> float:
    r = run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path])
    try:
        return float(r.stdout.strip())
    except ValueError:
        raise RuntimeError('오디오 파일이 아니거나 손상됐어요')


def loudness(path: str, extra: str = '') -> dict:
    """loudnorm 측정값 (input_i, input_tp, input_lra, input_thresh, target_offset)"""
    af = f'loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}{extra}:print_format=json'
    r = run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', af, '-f', 'null', '-'])
    m = re.findall(r'\{[^{}]*"input_i"[^{}]*\}', r.stderr, re.S)
    if not m:
        raise RuntimeError('음량을 측정하지 못했어요')
    return json.loads(m[-1])


def normalize(src: str, dst: str) -> dict:
    """-14 LUFS · 피크 -1 dBTP AAC 192k 파일 만들기 → 결과 파일 측정값.
    1) 원본 음량을 재서 -14 LUFS 가 되게 한 번에 키우거나 줄이고
    2) 4배 오버샘플링한 리미터로 피크를 눌러요 (AI 곡은 0 dBFS 를 넘는 피크가 많아요)
    3) AAC 로 바꾼 뒤 다시 재서, 피크가 넘치면 리미터 상한만 더 낮춰 다시 만들어요 (음량은 그대로)."""
    m = loudness(src)
    gain = TARGET_I - float(m['input_i'])
    ceiling = LIMIT_DB
    after = None
    for i in range(4):
        lim = 10 ** (ceiling / 20)
        af = (f'volume={gain:.2f}dB,aresample=176400,'
              f'alimiter=limit={lim:.4f}:attack=1:release=80:level=disabled,aresample=44100')
        r = run(['ffmpeg', '-hide_banner', '-nostats', '-y', '-i', src, '-af', af, '-ac', '2',
                 '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-vn', dst])
        if r.returncode != 0:
            raise RuntimeError('변환 실패: ' + r.stderr.strip().splitlines()[-1][:120])
        after = loudness(dst)
        tp = float(after['input_tp'])
        print(f'    음량 {i + 1}회: 원본 {m["input_i"]} LUFS / {m["input_tp"]} dBTP → '
              f'{after["input_i"]} LUFS / {tp} dBTP (게인 {gain:+.1f} dB · 상한 {ceiling:.1f} dB)', flush=True)
        if tp <= TARGET_TP + 0.2:
            break
        ceiling -= tp - TARGET_TP + 0.3
    return {'before_i': float(m['input_i']), 'before_tp': float(m['input_tp']),
            'after_i': float(after['input_i']), 'after_tp': float(after['input_tp'])}


def waveform(path: str, step_ms: int = 100) -> list[int]:
    """0.1초마다 음량(0~100) — 앱 LED 파형용"""
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'],
                       capture_output=True, check=False)
    pcm = array.array('h')
    pcm.frombytes(r.stdout[: len(r.stdout) // 2 * 2])
    n = 8000 * step_ms // 1000
    rms = []
    for i in range(0, len(pcm), n):
        chunk = pcm[i:i + n]
        if not chunk:
            break
        rms.append((sum(x * x for x in chunk) / len(chunk)) ** 0.5)
    top = max(rms) if rms else 0
    return [int(round(100 * v / top)) if top else 0 for v in rms][:6000]


def clip(src: str, start: float, seconds: int, dst: str) -> bytes:
    run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{max(start, 0):.1f}', '-t', str(seconds), '-i', src,
         '-ac', '1', '-ar', '8000', dst])
    return open(dst, 'rb').read()


# ---------------------------------------------------------------- 음원 대조 (ACRCloud)

def acr_identify(sample: bytes) -> dict:
    host, key, secret = os.environ['ACR_HOST'], os.environ['ACR_ACCESS_KEY'], os.environ['ACR_ACCESS_SECRET']
    ts = str(int(time.time()))
    to_sign = '\n'.join(['POST', '/v1/identify', key, 'audio', '1', ts])
    sig = base64.b64encode(hmac.new(secret.encode(), to_sign.encode(), hashlib.sha1).digest()).decode()
    import requests
    r = requests.post(f'https://{host}/v1/identify',
                      files={'sample': ('sample.wav', sample, 'audio/wav')},
                      data={'access_key': key, 'sample_bytes': str(len(sample)), 'timestamp': ts,
                            'signature': sig, 'data_type': 'audio', 'signature_version': '1'},
                      timeout=40)
    return r.json()


def acr_ready() -> bool:
    return all(os.environ.get(k) for k in ('ACR_HOST', 'ACR_ACCESS_KEY', 'ACR_ACCESS_SECRET'))


def fingerprint(src: str, length: float, tmp: str) -> tuple[bool | None, str, int]:
    """(일치 없음 여부, 설명, 일치 점수). 키가 없으면 (None, '미연결', 0)"""
    if not acr_ready():
        return None, '기존 곡 대조: 미연결 (ACRCloud 키 없음)', 0
    starts = sorted({max(0.0, s) for s in (min(30.0, length * 0.15), length * 0.5 - 7, length - 40)})
    for s in starts:
        if s + 5 > length:
            continue
        res = acr_identify(clip(src, s, 15, os.path.join(tmp, 'clip.wav')))
        code = res.get('status', {}).get('code')
        if code == 0:
            music = (res.get('metadata') or {}).get('music') or []
            if music:
                m = music[0]
                artists = ', '.join(a.get('name', '') for a in m.get('artists', []))
                score = int(m.get('score') or 0)
                return False, f"⚠ 기존 곡과 일치: '{m.get('title', '?')}' - {artists} (점수 {score}, {int(s)}초 지점)", score
        elif code not in (1001,):  # 1001 = 일치 없음
            return None, f"기존 곡 대조 오류: {res.get('status', {}).get('msg', code)}", 0
    return True, '기존 곡 대조: 일치 없음 (ACRCloud · 3구간)', 0


# ---------------------------------------------------------------- YARR 안 같은 음원 대조 (Chromaprint)

def chromaprint(path: str) -> list[int]:
    """FFmpeg 내장 Chromaprint 지문 (0.12초마다 32비트 값). FFmpeg 에 없으면 빈 목록"""
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-f', 'chromaprint', '-fp_format', 'raw', '-'],
                       capture_output=True, check=False)
    if r.returncode != 0 or len(r.stdout) < 4:
        return []
    a = array.array('I')
    a.frombytes(r.stdout[: len(r.stdout) // 4 * 4])
    return list(a)


def to_db(fp: list[int]) -> list[int]:
    """Postgres int[] 에 넣을 수 있게 부호 있는 32비트로"""
    return [x - (1 << 32) if x >= (1 << 31) else x for x in fp]


_POP = None


def similarity(a: list[int], b: list[int], win: int = 120) -> float:
    """두 지문이 얼마나 같은지 (0.5 ≈ 무관, 1.0 = 같은 음원). 새 곡의 15초 구간 3곳을 상대 곡 전체에 밀어 보며 비교"""
    import numpy as np
    global _POP
    if _POP is None:
        _POP = np.array([bin(i).count('1') for i in range(256)], dtype=np.uint8)
    A = np.asarray(a, dtype=np.int64).astype(np.uint32)
    B = np.asarray(b, dtype=np.int64).astype(np.uint32)
    win = min(win, len(A), len(B))
    if win < 40:
        return 0.0
    windows = np.lib.stride_tricks.sliding_window_view(B, win)
    best = 0.0
    for st in sorted({0, max(0, len(A) // 2 - win // 2), max(0, len(A) - win)}):
        seg = A[st:st + win]
        x = np.bitwise_xor(windows, seg)
        bits = _POP[x.view(np.uint8)].reshape(len(windows), -1).sum(axis=1)
        best = max(best, 1.0 - float(bits.min()) / (32 * win))
    return best


def known_fingerprints(sb) -> list[dict]:
    """공개 · 대기 중인 곡의 지문 (반려된 곡은 비교 안 함)"""
    out, start = [], 0
    while True:
        rows = (sb.table('track_fingerprints').select('track_id,fp,tracks(creator_id,status,title)')
                .range(start, start + 499).execute().data) or []
        out += [r for r in rows if (r.get('tracks') or {}).get('status') in ('ACTIVE', 'PENDING', 'TAKEDOWN_24H')]
        if len(rows) < 500:
            return out
        start += 500


def best_duplicate(fp: list[int], creator_id: str, track_id: str, known: list[dict]) -> tuple[float, dict | None]:
    best, hit = 0.0, None
    for k in known:
        if k['track_id'] == track_id:
            continue
        sim = similarity(fp, k['fp'])
        if sim > best:
            best, hit = sim, k
    return best, hit


# ---------------------------------------------------------------- 제목 · 프롬프트 검사

COVER_WORDS = ['커버', 'cover', '리메이크', 'remake', 'ai커버', 'ai 커버']   # 다른 사람 곡을 다시 부른 표기일 수 있음 → 사람 확인
MAYBE_WORDS = ['원곡', '메들리', 'medley', 'mashup', '매시업', '샘플링', 'sampling', 'style of', 'in the style',
               'voice of', 'sounds like', 'type beat', '모창', '풍으로', '목소리로']   # 확인 필요
# 이름이 들어 있으면 사람이 확인 (우연히 겹칠 수 있어서 자동 반려는 안 함). 운영하면서 계속 늘려 주세요.
ARTISTS = [
    '아이유', '방탄소년단', '뉴진스', '블랙핑크', '아이브', '에스파', '르세라핌', '트와이스', '세븐틴', '빅뱅', '지드래곤',
    '태연', '소녀시대', '엑소', '레드벨벳', '임영웅', '영탁', '이찬원', '송가인', '장윤정', '나훈아', '조용필', '이미자',
    '성시경', '박효신', '김범수', '나얼', '이문세', '김광석', '싸이', '악뮤', '아이들', '스트레이키즈', '데이식스', '잔나비',
    '10cm', '볼빨간사춘기', '헤이즈', '백예린', '폴킴', '멜로망스', '임재범', '이선희', '윤종신', '김건모', '신승훈', '이승철',
    'BTS', 'IU', 'NewJeans', 'BLACKPINK', 'IVE', 'aespa', 'LE SSERAFIM', 'TWICE', 'SEVENTEEN', 'BIGBANG', 'G-DRAGON',
    'Taylor Swift', 'Drake', 'Ariana Grande', 'The Weeknd', 'Beyonce', 'Michael Jackson', 'Ed Sheeran', 'Billie Eilish',
    'Bruno Mars', 'Justin Bieber', 'Rihanna', 'Eminem', 'Coldplay', 'Beatles', 'Dua Lipa', 'Post Malone',
    'Kendrick Lamar', 'SZA', 'Olivia Rodrigo', 'Sabrina Carpenter', 'Bad Bunny', 'Lady Gaga', 'Adele', 'Harry Styles',
    'Travis Scott', 'Kanye West', 'Frank Ocean', 'Daft Punk', 'Nujabes', 'Lana Del Rey', 'Doja Cat',
    # 일본 (시티팝 · J-POP)
    'Tatsuro Yamashita', '山下達郎', '야마시타 타츠로', 'Mariya Takeuchi', '竹内まりや', '다케우치 마리야', 'Anri', '杏里',
    'Miki Matsubara', '松原みき', 'YOASOBI', 'Kenshi Yonezu', '米津玄師', 'Ado', 'Official髭男dism', 'King Gnu',
    'Utada Hikaru', '宇多田ヒカル', 'Aimer', 'LiSA', 'Fujii Kaze', '藤井風', 'Vaundy', 'Mrs. GREEN APPLE', 'back number',
]


def text_flags(title: str, prompt: str, lyrics: str = '') -> tuple[list[str], list[str], list[str]]:
    """(반려 사유, 확인 필요 사유, 관리자 화면에 노란색으로 보일 단어)
    커버 · 원곡 · 실존 가수 이름은 정상 설명일 수도 있어서('album cover', '원곡 프롬프트를 변주') 자동 반려하지 않고 사람에게 넘겨요."""
    text = f'{title} {prompt} {lyrics}'
    low = text.lower()
    reject, hold, flags = [], [], []
    words = [w for w in COVER_WORDS if w in low]
    if words:
        hold.append(f"커버 · 리메이크 표기 ('{words[0]}') — 원곡을 다시 부른 곡인지 확인")
        flags += words[:2]
    maybe = [w for w in MAYBE_WORDS if w in low]
    if maybe:
        hold.append(f"원곡 · 스타일 · 모창 표기 ('{maybe[0]}')")
        flags += maybe[:3]
    names = []
    for a in ARTISTS:
        if re.fullmatch(r'[A-Za-z0-9 .\-]+', a):
            if re.search(r'(?<![A-Za-z0-9])' + re.escape(a.lower()) + r'(?![A-Za-z0-9])', low):
                names.append(a)
        elif a in text:
            names.append(a)
    if names:
        hold.append('실존 가수 이름: ' + ', '.join(names[:3]))
        flags += names[:3]
    if '#' in title:
        hold.append('제목에 해시태그 (가수 · 원곡 이름을 태그로 붙이는 경우가 많아요)')
        flags.append('#')
    return reject, hold, list(dict.fromkeys(flags))[:8]


# ---------------------------------------------------------------- 가사 중복 (YARR 안)

def lyric_lines(text: str) -> set[str]:
    """비교용 가사 줄: 공백 · 문장부호를 지우고 소문자, 4글자 이상인 줄만"""
    out = set()
    for line in (text or '').splitlines():
        k = re.sub(r'[\s\W_]+', '', line.lower())
        if len(k) >= 4:
            out.add(k)
    return out


def known_lyrics(sb) -> list[dict]:
    try:
        return (sb.table('tracks').select('id,title,creator_id,lyrics').not_.is_('lyrics', 'null')
                .in_('status', ['ACTIVE', 'PENDING', 'TAKEDOWN_24H']).limit(5000).execute().data) or []
    except Exception:
        return []   # 016 SQL 전


def lyrics_duplicate(lyrics: str, track_id: str, others: list[dict]) -> tuple[float, dict | None]:
    """새 곡 가사 줄 중 다른 곡과 겹치는 비율이 가장 높은 곡"""
    mine = lyric_lines(lyrics)
    if len(mine) < 4:
        return 0.0, None
    best, hit = 0.0, None
    for o in others:
        if o['id'] == track_id:
            continue
        theirs = lyric_lines(o.get('lyrics') or '')
        if not theirs:
            continue
        r = len(mine & theirs) / len(mine)
        if r > best:
            best, hit = r, o
    return best, hit


LYRICS_HOLD = 0.6   # 가사 줄 60% 이상 같으면 사람 확인


# ---------------------------------------------------------------- 한 곡 검수

def fade_edges(src: str, length: float, dst: str, fade_out: float = 5.0) -> str:
    """앞 0.5초 페이드인 · 끝 5초 페이드아웃 (AI 곡이 뚝 끊기는 걸 부드럽게). 실패하면 원본 그대로"""
    if length < 20:
        return src
    af = f'afade=t=in:st=0:d=0.5,afade=t=out:st={max(0.0, length - fade_out):.2f}:d={fade_out}'
    r = run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-af', af, '-vn', '-c:a', 'pcm_f32le', dst])   # 32비트 실수: 0 dBFS 넘는 피크를 자르지 않고 그대로 넘겨요
    return dst if r.returncode == 0 and os.path.exists(dst) else src


def inspect_file(src: str, tmp: str, use_acr: bool = True, fade: bool = False) -> tuple[dict, str, dict]:
    """(DB 에 적을 값, 변환 파일 경로, 자동 결정에 쓸 측정값). fade=True 면 앞뒤를 부드럽게 (YARR 오리지널)"""
    length = duration_sec(src)
    out = os.path.join(tmp, 'normalized.m4a')
    lv = normalize(fade_edges(src, length, os.path.join(tmp, 'faded.wav')) if fade else src, out)
    clean, acr_note, acr_score = fingerprint(src, length, tmp) if use_acr else (True, '기존 곡 대조: 생략 (YARR 오리지널 · 운영사가 직접 생성)', 0)
    notes = [f"원본 {lv['before_i']:.1f} LUFS → 변환 {lv['after_i']:.1f} LUFS", acr_note]
    if length < MIN_PLAY_SEC:
        notes.append(f'⚠ {MIN_PLAY_SEC}초보다 짧아요 (재생이 집계되지 않아요)')
    if length > 15 * 60:
        notes.append('⚠ 15분보다 길어요')
    if lv['before_i'] < -40:
        notes.append('⚠ 거의 무음이에요')
    row = {
        'duration_sec': max(1, int(round(length))),
        'lufs_value': round(lv['after_i'], 1),
        'peak_dbtp': round(lv['after_tp'], 1),
        'waveform': waveform(out),
        'fingerprint_clean': bool(clean),
        'inspection_note': ' · '.join(notes)[:900],
    }
    facts = {'length': length, 'before_i': lv['before_i'], 'acr': clean, 'acr_score': acr_score, 'acr_note': acr_note,
             'fp': chromaprint(out)}
    return row, out, facts


HOUSE_ID = '00000000-0000-0000-0000-0000000000a1'   # 'YARR Originals' (운영사가 Stable Audio 3 로 만든 곡)


def decide(t: dict, facts: dict, dup: tuple[float, dict | None], trusted: bool, recent_copy_reject: bool) -> tuple[str, str, str]:
    """('APPROVE' | 'REJECT' | 'HOLD', 반려 이유, 설명)"""
    reject: list[tuple[str, str]] = []
    hold: list[str] = []
    plan = (t.get('ai_plan') or '')
    if '무료' in plan or 'free' in plan.lower():
        reject.append((R_LICENSE, '무료 플랜으로 만든 곡은 상업 이용이 안 돼요'))
    if facts['acr'] is False:
        if facts['acr_score'] >= ACR_REJECT_SCORE:
            reject.append((R_COPY, facts['acr_note'].lstrip('⚠ ')))
        else:
            hold.append(facts['acr_note'].lstrip('⚠ ') + ' (약한 일치)')
    sim, hit = dup
    if hit is not None and sim >= DUP_REJECT:
        mine = (hit.get('tracks') or {}).get('creator_id') == t['creator_id']
        title = (hit.get('tracks') or {}).get('title', '?')
        reject.append((R_DUP, f"{'내가 이미 올린' if mine else '다른 크리에이터의'} '{title}'와 같은 음원 ({sim:.0%})"))
    elif hit is not None and sim >= DUP_HOLD:
        hold.append(f"'{(hit.get('tracks') or {}).get('title', '?')}'와 비슷함 ({sim:.0%})")
    if facts['before_i'] < -40:
        reject.append((R_QUALITY, '거의 무음'))
    if facts['length'] < MIN_PLAY_SEC:
        reject.append((R_SHORT, f"{int(facts['length'])}초"))
    if facts['length'] > 15 * 60:
        hold.append('15분보다 김')
    if not facts['fp']:
        hold.append('음원 지문을 만들지 못함 (YARR 안 중복 대조 못 함)')
    tr, th, _ = text_flags(t.get('title') or '', t.get('prompt_recipe') or '', t.get('lyrics') or '')
    for r in tr:
        reject.append((R_COPY, r))
    hold += th
    lsim, lhit = facts.get('lyrics_dup') or (0.0, None)
    if lhit is not None and lsim >= LYRICS_HOLD:
        hold.append(f"'{lhit.get('title', '?')}' 가사와 {lsim:.0%} 같음")

    if reject:
        reason = reject[0][0]
        return 'REJECT', reason, ' · '.join(n for _, n in reject)
    if hold:
        return 'HOLD', '', ' · '.join(hold)
    if t.get('creator_id') == HOUSE_ID:
        # 운영사가 직접 만든 곡: 라이선스(Stable Audio 3 Community License)를 운영사가 확인했고 YARR 안 중복 · 음량 검사도 통과
        return 'APPROVE', '', 'YARR 오리지널 (운영사 생성 · Stable Audio 3) · YARR 중복 대조 · 음량 검사 통과'
    if recent_copy_reject:
        return 'HOLD', '', '최근 90일 안에 권리 문제로 반려된 곡이 있는 크리에이터 (경고 상태)'
    if facts['acr'] is True:
        return 'APPROVE', '', '기존 곡 대조 · YARR 중복 대조 · 음량 · 제목 검사 모두 통과'
    if os.environ.get('AUTO_APPROVE_WITHOUT_ACR') == '1' and trusted:
        return 'APPROVE', '', '믿을 만한 크리에이터 (공개 곡 5곡 이상 · 90일 권리 경고 없음) · YARR 중복 대조 · 음량 · 제목 검사 통과 (ACRCloud 없음)'
    return 'HOLD', '', '자동 승인 조건 미충족: 기존 상업 음원 대조(ACRCloud)가 연결돼 있지 않아요'


# ---------------------------------------------------------------- 서버

def client():
    from supabase import create_client
    return create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SECRET_KEY'])


def pending(sb) -> list[dict]:
    def q(cols):
        return (sb.table('tracks').select(cols)
                .eq('status', 'PENDING').is_('inspected_at', 'null')
                .like('original_url', 'storage:uploads/%')
                .order('created_at').limit(BATCH).execute().data) or []
    try:
        return q('id,title,original_url,creator_id,ai_plan,prompt_recipe,lyrics')
    except Exception:
        return q('id,title,original_url,creator_id,ai_plan,prompt_recipe')   # 016 SQL 전


def creator_record(sb, creator_id: str) -> tuple[bool, bool]:
    """(믿을 만한가, 최근 권리 문제 반려 있음)
    014 SQL 이후: 서버 creator_standing (공개 곡 5곡 이상 · 90일 권리 경고 0 · 가입 14일 이상 · 익명 아님)
    014 전: 관리자 승인 곡 2개 이상 · 30일 권리 반려 없음"""
    try:
        r = (sb.rpc('creator_standing', {'p_user': creator_id}).execute().data or [{}])[0]
        if 'trusted' in r:
            return bool(r.get('trusted')), int(r.get('strikes_90d') or 0) > 0
    except Exception:
        pass
    approved = (sb.table('tracks').select('id', count='exact').eq('creator_id', creator_id)
                .eq('status', 'ACTIVE').not_.is_('reviewed_by', 'null').execute().count) or 0
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=30)).isoformat()
    rej = (sb.table('tracks').select('reject_reason').eq('creator_id', creator_id).eq('status', 'REJECTED')
           .gte('created_at', since).execute().data) or []
    copy = any(r.get('reject_reason') in (R_COPY, R_ARTIST, R_DUP, 'TAKEDOWN_UPHELD') for r in rej)
    return approved >= 2 and not copy, copy


def process(sb, t: dict, known: list[dict], lyrics_db: list[dict] | None = None) -> str:
    path = t['original_url'][len('storage:uploads/'):]
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    verdict = None
    with tempfile.TemporaryDirectory() as tmp:
        try:
            src = os.path.join(tmp, 'original' + os.path.splitext(path)[1])
            with open(src, 'wb') as f:
                f.write(sb.storage.from_('uploads').download(path))
            row, out, facts = inspect_file(src, tmp, use_acr=t.get('creator_id') != HOUSE_ID, fade=t.get('creator_id') == HOUSE_ID)
            facts['lyrics_dup'] = lyrics_duplicate(t.get('lyrics') or '', t['id'], lyrics_db or [])
            folder, name = path.rsplit('/', 1)
            norm = f"{folder}/norm-{os.path.splitext(name)[0]}.m4a"
            with open(out, 'rb') as f:
                sb.storage.from_('uploads').upload(norm, f.read(), {'content-type': 'audio/mp4', 'upsert': 'true'})
            row.update({'normalized_url': f'storage:uploads/{norm}', 'inspected_at': now})
            dup = best_duplicate(facts['fp'], t['creator_id'], t['id'], known) if facts['fp'] else (0.0, None)
            if facts['fp']:
                sb.table('track_fingerprints').upsert({'track_id': t['id'], 'fp': to_db(facts['fp'])}).execute()
                known.append({'track_id': t['id'], 'fp': facts['fp'],
                              'tracks': {'creator_id': t['creator_id'], 'status': 'PENDING', 'title': t['title']}})
            trusted, recent = creator_record(sb, t['creator_id'])
            verdict = decide(t, facts, dup, trusted, recent)
            if verdict[0] == 'HOLD':
                row['inspection_note'] = (f"⚠ 자동 보류: {verdict[2]} · " + row['inspection_note'])[:900]
            flags = text_flags(t.get('title') or '', t.get('prompt_recipe') or '', t.get('lyrics') or '')[2]
            if flags:
                row['review_flags'] = flags
        except Exception as e:  # 실패해도 관리자가 볼 수 있게 기록하고 다음 곡으로
            row = {'inspected_at': now, 'inspection_note': f'⚠ 자동 검수 실패: {str(e)[:300]} · 관리자가 직접 확인해 주세요'}
        try:
            sb.table('tracks').update(row).eq('id', t['id']).execute()
        except Exception:
            row.pop('review_flags', None)   # 016 SQL 전
            sb.table('tracks').update(row).eq('id', t['id']).execute()
        if verdict and verdict[0] != 'HOLD' and os.environ.get('AUTO_DECIDE', '1') != '0':
            sb.rpc('auto_decide_track', {'p_track_id': t['id'], 'p_approve': verdict[0] == 'APPROVE',
                                         'p_reason': verdict[1] or None, 'p_note': verdict[2]}).execute()
            return f"{'자동 승인' if verdict[0] == 'APPROVE' else '자동 반려 (' + verdict[1] + ')'}: {verdict[2]}"
        return row['inspection_note']


def backfill(sb, known: list[dict], limit: int = 10) -> int:
    """공개 곡 중 지문이 없는 곡(011 전에 승인된 곡)에 지문 채우기 → 앞으로 올라올 곡과 대조"""
    have = {k['track_id'] for k in known}
    rows = (sb.table('tracks').select('id,title,creator_id,status,audio_url').eq('status', 'ACTIVE')
            .like('audio_url', 'storage:uploads/%').limit(500).execute().data) or []
    n = 0
    for r in rows:
        if r['id'] in have or n >= limit:
            continue
        with tempfile.TemporaryDirectory() as tmp:
            try:
                src = os.path.join(tmp, 'a' + os.path.splitext(r['audio_url'])[1])
                with open(src, 'wb') as f:
                    f.write(sb.storage.from_('uploads').download(r['audio_url'][len('storage:uploads/'):]))
                fp = chromaprint(src)
                if fp:
                    sb.table('track_fingerprints').upsert({'track_id': r['id'], 'fp': to_db(fp)}).execute()
                    known.append({'track_id': r['id'], 'fp': fp, 'tracks': {'creator_id': r['creator_id'], 'status': 'ACTIVE', 'title': r['title']}})
                    n += 1
            except Exception as e:
                print(f"  지문 채우기 실패 {r['title']}: {e}")
    return n


def cleanup(sb):
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=365)).isoformat()
    sb.table('client_errors').delete().lt('created_at', cutoff).execute()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', help='서버 없이 이 파일만 측정 · 변환해 보기')
    ap.add_argument('--count', action='store_true', help='검수할 곡 수만 확인 (GitHub Actions 용)')
    ap.add_argument('--title', help='--file 시험용 곡 제목')
    ap.add_argument('--prompt', help='--file 시험용 프롬프트')
    ap.add_argument('--plan', help='--file 시험용 구독 플랜')
    ap.add_argument('--compare', nargs='*', help='--file 과 같은 음원인지 비교할 다른 파일들')
    a = ap.parse_args()

    if a.file:
        with tempfile.TemporaryDirectory() as tmp:
            row, out, facts = inspect_file(a.file, tmp)
            row['waveform'] = f"{len(row['waveform'])}개 값"
            t = {'title': a.title or os.path.basename(a.file), 'prompt_recipe': a.prompt or '', 'ai_plan': a.plan or '', 'creator_id': 'local'}
            known = []
            for other in a.compare or []:
                known.append({'track_id': other, 'fp': chromaprint(other), 'tracks': {'creator_id': 'other', 'title': os.path.basename(other)}})
            dup = best_duplicate(facts['fp'], 'local', '', known) if facts['fp'] else (0.0, None)
            v = decide(t, facts, dup, trusted=False, recent_copy_reject=False)
            row['자동 결정'] = {'결과': v[0], '반려 이유': v[1], '설명': v[2], '음원 지문': f"{len(facts['fp'])}개 값"}
            print(json.dumps(row, ensure_ascii=False, indent=2))
        return

    sb = client()
    todo = pending(sb)
    if a.count:
        print(f'검수할 곡: {len(todo)}개')
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a') as f:
                f.write(f'pending={len(todo)}\n')
        return
    print(run(['ffmpeg', '-version']).stdout.splitlines()[0][:80], flush=True)
    known = known_fingerprints(sb)
    lyrics_db = known_lyrics(sb)
    for t in todo:
        print(f"- {t['title']}: {process(sb, t, known, lyrics_db)}")
    print(f'지문 채움: {backfill(sb, known)}곡')
    cleanup(sb)
    print(f'완료: {len(todo)}곡')


if __name__ == '__main__':
    sys.exit(main())
