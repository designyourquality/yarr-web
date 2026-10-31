"""쇼츠 · 릴스 영상 굽기 (043 SQL · GitHub Actions 무료 CPU · FFmpeg 만)

앱에서 [🎬 쇼츠 영상 만들기] 를 누르면 short_jobs 에 작업이 생기고, 서버가 이 워커(shorts.yml)를 바로 깨워요.
  1) 곡의 하이라이트 15초 (앱이 고른 시작 초, 없으면 가장 꽉 찬 15초)
  2) 720×1280 세로 화면: YARR 로고 · 곡 제목 · 크리에이터 · 레시피(스테이션 · 장르 · BPM · 조성)
     + 소리에 맞춰 움직이는 주황 도트 스펙트럼 + 지금 나오는 코드 (AI 추정) + 워터마크
  3) shorts/<계정>/<작업>.mp4 (비공개)에 올리고 DONE. 앱이 받아서 공유 창으로 넘겨요.
영상은 24시간 뒤 지워요 (EXPIRED).

직접 시험: python worker/shorts.py --file 곡.m4a --title 제목 --artist 이름 [--chords chords.json] [--out out.mp4]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

W, H = 720, 1280
SECONDS = 15.0
ORANGE = '0xFF7B2F'
BG = '0x17171A'
PANEL = '0x0E0E10'
SOFT = '0xB8B3A8'
KEEP_HOURS = 24
RUN_BUDGET = float(os.environ.get('SHORTS_BUDGET_MIN', '20')) * 60

# 스테이션 코드 → 화면 이름 (앱 catalog.dart 와 같게)
STATIONS = {
    '#NIGHT_DRIVE': '#야간드라이브', '#WOOD_CAFE': '#우드톤카페', '#RAINY_LOFI': '#비오는날', '#FOCUS_CODE': '#코딩집중',
    '#GYM_CARDIO': '#헬스장유산소', '#STUDY_CAFE': '#스터디카페', '#PUB_LOUNGE': '#펍/라운지', '#MORNING_BAKERY': '#모닝베이커리',
    '#WINE_BAR': '#와인/다이닝바', '#BOUTIQUE': '#힙한편집샵', '#SPA_YOGA': '#힐링요가/스파', '#ROOFTOP': '#루프탑/선셋',
    '#DAWN_MOOD': '#새벽감성', '#HANGANG_PICNIC': '#한강피크닉', '#SUMMER_BEACH': '#여름바다', '#POCHA_NIGHT': '#포차/퇴근길',
}
KEYS_KO = {'Major': '장조', 'Minor': '단조'}


def font_path(bold: bool = True) -> str:
    env = os.environ.get('SHORTS_FONT_BOLD' if bold else 'SHORTS_FONT')
    if env and os.path.exists(env):
        return env
    for p in ([
        '/usr/share/fonts/truetype/nanum/NanumGothicExtraBold.ttf', '/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf',
    ] if bold else ['/usr/share/fonts/truetype/nanum/NanumGothic.ttf']) + [
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc' if bold else '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    ]:
        if os.path.exists(p):
            return p
    r = subprocess.run(['fc-match', '-f', '%{file}', 'NanumGothic:bold' if bold else 'NanumGothic'], capture_output=True, text=True)
    if r.returncode == 0 and r.stdout.strip():
        return r.stdout.strip()
    raise RuntimeError('한글 글꼴이 없어요 (fonts-nanum 설치 필요)')


def duration(path: str) -> float:
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def best_start(path: str, length: float = SECONDS) -> float:
    """가장 꽉 찬(소리가 큰) 구간의 시작 초. 앞 10% · 끝 5초는 건너뛰어요 (인트로 · 페이드아웃)"""
    from chords import decode, SR
    x = decode(path)
    if len(x) < SR * (length + 2):
        return 0.0
    sec = np.sqrt(np.add.reduceat(x * x, np.arange(0, len(x), SR)) / SR)
    win = int(length)
    total = len(sec)
    lo = max(0, int(total * 0.1))
    hi = max(lo, total - win - 5)
    if hi <= lo:
        return 0.0
    sums = np.convolve(sec, np.ones(win), mode='valid')
    i = lo + int(np.argmax(sums[lo:hi + 1]))
    return float(i)


def _esc(path: str) -> str:
    """FFmpeg 필터 안의 파일 경로 (콜론 · 따옴표)"""
    return path.replace('\\', '/').replace(':', '\\:').replace("'", "\\'")


def _clip(text: str, n: int) -> str:
    text = ' '.join((text or '').split())
    return text if len(text) <= n else text[: n - 1] + '…'


def chord_windows(chords: list[dict], start: float, length: float) -> list[tuple[float, float, str, str]]:
    """15초 안에 보일 코드: (영상 안 시작, 끝, 지금 코드, 다음 코드). 'N'(코드 없음)은 '—'"""
    out = []
    seq = [(float(c.get('t', 0)), str(c.get('c', ''))) for c in chords or [] if c.get('c')]
    for i, (t, c) in enumerate(seq):
        end = seq[i + 1][0] if i + 1 < len(seq) else 1e9
        a, b = max(t, start), min(end, start + length)
        if b <= a:
            continue
        nxt = next((seq[j][1] for j in range(i + 1, len(seq)) if seq[j][1] != 'N'), '')
        out.append((round(a - start, 2), round(b - start, 2), '—' if c == 'N' else c, nxt))
    return out


def render(src: str, out: str, meta: dict, start: float | None = None, length: float = SECONDS) -> dict:
    """src 오디오 → out MP4. meta: title, artist, station, genre, bpm, key, chords, vocal"""
    dur = duration(src)
    if dur <= 1:
        raise RuntimeError('오디오 길이를 읽지 못했어요')
    length = min(length, max(3.0, dur))
    if start is None:
        start = best_start(src, length)
    start = max(0.0, min(float(start), max(0.0, dur - length)))
    bold, reg = _esc(font_path(True)), _esc(font_path(False))
    tmp = tempfile.mkdtemp(prefix='short_')
    files: dict[str, str] = {}

    def tf(name: str, text: str) -> str:
        p = os.path.join(tmp, name + '.txt')
        with open(p, 'w', encoding='utf-8') as f:
            f.write(text)
        files[name] = p
        return _esc(p)

    title = _clip(meta.get('title') or '제목 없음', 20)
    tsize = max(34, min(64, int(600 / max(1, len(title)))))
    artist = _clip(meta.get('artist') or '', 18)
    parts = [STATIONS.get(meta.get('station') or '', ''), meta.get('genre') or '', f"{meta['bpm']} BPM" if meta.get('bpm') else '']
    key = (meta.get('key') or '').strip()
    if key:
        k = key.split()
        parts.append(f"{k[0]} {KEYS_KO.get(k[-1], k[-1])}" if len(k) == 2 else key)
    recipe = _clip(' · '.join(p for p in parts if p), 34)
    vocal = '보컬곡' if meta.get('vocal') else '연주곡'

    dt = lambda txt, size, y, color='white', font=bold, x='(w-text_w)/2', extra='': (
        f"drawtext=fontfile='{font}':textfile='{txt}':fontsize={size}:fontcolor={color}:x={x}:y={y}{extra}")
    v = [
        f"color=c={BG}:s={W}x{H}:r=30:d={length},drawbox=x=24:y=96:w={W - 48}:h=1040:color={PANEL}:t=fill[bg]",
        # 도트 스펙트럼: 48×18 막대 → 14px 칸으로 키우고 칸 사이를 배경색 선으로 갈라 도트처럼
        "[0:a]asplit=2[a0][a1]",
        f"[a0]showfreqs=s=48x19:mode=bar:ascale=sqrt:fscale=log:colors={ORANGE}:win_size=2048,crop=48:18:0:0,format=rgba,"
        f"scale={48 * 14}:{18 * 14}:flags=neighbor,drawgrid=w=14:h=14:t=4:c={PANEL}@1[spec]",
    ]
    draw = [
        dt(tf('logo', 'YARR'), 92, 150, ORANGE),
        dt(tf('tag', 'AI MUSIC CHART · 버튼으로 만드는 내 노래'), 26, 262, SOFT, reg),
        f"drawbox=x=60:y=318:w={W - 120}:h=3:color={ORANGE}@0.6:t=fill",
        dt(tf('title', title), tsize, 392 - tsize // 2),
        dt(tf('artist', f'by {artist}' if artist else vocal), 32, 450, SOFT, reg),
        dt(tf('recipe', recipe or vocal), 28, 506, ORANGE, reg),
    ]
    cw = chord_windows(meta.get('chords') or [], start, length)
    if cw:
        draw.append(dt(tf('chlabel', 'AI 추정 코드'), 24, 870, SOFT, reg))
        for i, (a, b, c, n) in enumerate(cw[:40]):
            en = f":enable='between(t,{a},{b - 0.001})'"
            draw.append(dt(tf(f'c{i}', c), 112, 908, 'white', bold, extra=en))
            if n:
                draw.append(dt(tf(f'n{i}', f'다음  {n}'), 28, 1040, SOFT, reg, extra=en))
    draw += [
        dt(tf('wm1', 'YARR에서 1분 만에 만든 내 노래'), 32, 1170, 'white'),
        dt(tf('wm2', '이 레시피로 내 버전 만들기 · YARR 앱'), 26, 1218, ORANGE, reg),
    ]
    v.append(f"[bg][spec]overlay=x=24:y=580,{','.join(draw)},format=yuv420p[v]")
    fade_out = max(0.0, length - 1.5)
    a = f"[a1]afade=t=in:d=0.4,afade=t=out:st={fade_out}:d=1.5,aresample=44100[a]"
    graph = ';'.join(v + [a])
    cmd = ['ffmpeg', '-v', 'error', '-y', '-ss', f'{start:.2f}', '-t', f'{length:.2f}', '-i', src,
           '-filter_complex', graph, '-map', '[v]', '-map', '[a]',
           '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-r', '30', '-pix_fmt', 'yuv420p',
           '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-shortest', out]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(out) or os.path.getsize(out) < 10_000:
        raise RuntimeError('영상 만들기 실패: ' + (r.stderr or '')[-400:])
    for p in files.values():
        try:
            os.remove(p)
        except OSError:
            pass
    return {'start': start, 'length': length, 'bytes': os.path.getsize(out), 'chords': len(cw)}


# ---------------------------------------------------------------- 서버 작업

def client():
    from supabase import create_client
    return create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SECRET_KEY'])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def claim(sb) -> dict | None:
    rows = (sb.table('short_jobs').select('id,user_id,track_id,start_sec').eq('status', 'PENDING')
            .order('created_at').limit(1).execute().data) or []
    if not rows:
        return None
    j = rows[0]
    got = (sb.table('short_jobs').update({'status': 'RUNNING', 'started_at': _now().isoformat()})
           .eq('id', j['id']).eq('status', 'PENDING').execute().data)
    return j if got else claim(sb)


def track_meta(sb, track_id: str) -> tuple[dict, str]:
    t = (sb.table('tracks').select('title,creator_id,audio_url,genre,bpm,situation_tags,chords,musical_key,is_instrumental,status')
         .eq('id', track_id).limit(1).execute().data or [None])[0]
    if not t or t.get('status') != 'ACTIVE' or not str(t.get('audio_url') or '').startswith('storage:uploads/'):
        raise RuntimeError('공개된 곡이 아니에요')
    u = (sb.table('users').select('nickname').eq('id', t['creator_id']).limit(1).execute().data or [{}])[0]
    ch = t.get('chords') or {}
    meta = {
        'title': t.get('title'), 'artist': u.get('nickname') or '', 'genre': t.get('genre') or '', 'bpm': t.get('bpm'),
        'station': (t.get('situation_tags') or [None])[0], 'key': t.get('musical_key') or (ch.get('key') if isinstance(ch, dict) else ''),
        'chords': ch.get('chords') if isinstance(ch, dict) else [], 'vocal': not t.get('is_instrumental'),
    }
    return meta, t['audio_url'][len('storage:uploads/'):]


def do_job(sb, j: dict) -> str:
    meta, path = track_meta(sb, j['track_id'])
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, 'src' + os.path.splitext(path)[1])
        with open(src, 'wb') as f:
            f.write(sb.storage.from_('uploads').download(path))
        out = os.path.join(tmp, 'short.mp4')
        start = float(j['start_sec']) if j.get('start_sec') is not None else None
        info = render(src, out, meta, start)
        dest = f"{j['user_id']}/{j['id']}.mp4"
        with open(out, 'rb') as f:
            sb.storage.from_('shorts').upload(dest, f.read(), {'content-type': 'video/mp4', 'upsert': 'true'})
    sb.table('short_jobs').update({'status': 'DONE', 'video_path': dest, 'done_at': _now().isoformat(), 'error': None}).eq('id', j['id']).execute()
    return f"{meta['title']} · {info['start']:.0f}초부터 · {info['bytes'] // 1024}KB · 코드 {info['chords']}개"


def expire(sb) -> int:
    """24시간 지난 영상 지우기 · 15분 넘게 RUNNING 인 작업은 다시 대기로"""
    cut = (_now() - timedelta(hours=KEEP_HOURS)).isoformat()
    rows = (sb.table('short_jobs').select('id,video_path').eq('status', 'DONE').lt('done_at', cut).limit(200).execute().data) or []
    paths = [r['video_path'] for r in rows if r.get('video_path')]
    if paths:
        sb.storage.from_('shorts').remove(paths)
    for r in rows:
        sb.table('short_jobs').update({'status': 'EXPIRED', 'video_path': None}).eq('id', r['id']).execute()
    stuck = (_now() - timedelta(minutes=15)).isoformat()
    sb.table('short_jobs').update({'status': 'PENDING', 'started_at': None}).eq('status', 'RUNNING').lt('started_at', stuck).execute()
    return len(rows)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--file')
    ap.add_argument('--out', default='short.mp4')
    ap.add_argument('--title', default='시험 곡')
    ap.add_argument('--artist', default='야르')
    ap.add_argument('--station', default='#WOOD_CAFE')
    ap.add_argument('--genre', default='재즈')
    ap.add_argument('--bpm', type=int, default=96)
    ap.add_argument('--chords')
    ap.add_argument('--start', type=float)
    ap.add_argument('--count', action='store_true')
    a = ap.parse_args()
    if a.file:
        ch = {}
        if a.chords:
            with open(a.chords, encoding='utf-8') as f:
                ch = json.load(f)
        meta = {'title': a.title, 'artist': a.artist, 'station': a.station, 'genre': a.genre, 'bpm': a.bpm,
                'key': ch.get('key', ''), 'chords': ch.get('chords', []), 'vocal': True}
        print(render(a.file, a.out, meta, a.start))
        return
    sb = client()
    if a.count:
        n = len(sb.table('short_jobs').select('id').in_('status', ['PENDING', 'RUNNING']).limit(50).execute().data or [])
        print(f'대기 {n}개')
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a') as f:
                f.write(f'pending={n}\n')
        return
    t0 = time.time()
    print(f'만료 정리 {expire(sb)}개')
    idle = 0
    while time.time() - t0 < RUN_BUDGET:
        j = claim(sb)
        if not j:
            # 방금 들어온 요청을 놓치지 않게 잠깐 더 기다려요 (서버가 1분 안에는 다시 안 깨워서)
            if idle >= 6:
                break
            idle += 1
            time.sleep(10)
            continue
        idle = 0
        try:
            print('완성', do_job(sb, j))
        except Exception as e:  # noqa: BLE001 — 한 곡 실패가 다음 작업을 막지 않게
            print('실패', j['id'], e)
            sb.table('short_jobs').update({'status': 'FAILED', 'error': str(e)[:300], 'done_at': _now().isoformat()}).eq('id', j['id']).execute()


if __name__ == '__main__':
    main()
