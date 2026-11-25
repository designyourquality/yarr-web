"""YARR 곡별 공유 페이지 만들기 (docs/s/<곡 id>.html)

카톡 · 인스타 · 문자로 https://yarrmusic.com/s/<곡 id> 를 보내면
미리보기에 곡 제목 · 만든 사람 · 커버 그림이 떠요. 사람이 누르면 바로 듣기 화면(listen.html?t=...)으로 넘어가요.

- 공개된 곡(ACTIVE · 공개 시각 지남 · 크리에이터가 숨기지 않음)만 만들어요.
- 순위 · 재생 수 같은 숫자는 넣지 않아요 (미리보기는 카톡이 오래 기억해서 숫자가 금방 틀려져요).
- 커버 그림은 listen.html 과 같은 규칙으로 고른 docs/og/<풀>/<번호>.jpg 를 써요.
- 내용이 바뀐 파일만 다시 써요. 비공개로 바뀐 곡의 페이지는 지워요.

GitHub Actions(share_pages.yml)가 30분마다 돌려요. 비밀값은 저장소 Secrets 에서만 읽어요.
"""
import html
import os
import re
from datetime import datetime, timezone

from supabase import create_client

SITE = 'https://yarrmusic.com'
OUT = os.path.join(os.path.dirname(__file__), '..', 'docs', 's')

# listen.html 의 COVER_POOLS · COVER_ALIAS · poolOf 와 같게 유지해요
COVER_POOLS = {'night_drive': 10, 'wood_cafe': 10, 'rainy_lofi': 10, 'focus_code': 10, 'gym_cardio': 10, 'study_cafe': 10,
               'pub_lounge': 10, 'morning_bakery': 10, 'wine_bar': 10, 'boutique': 10, 'spa_yoga': 10, 'rooftop': 10,
               'dawn_mood': 10, 'hangang_picnic': 10, 'summer_beach': 10, 'pocha_night': 10, 'mix': 40}
COVER_ALIAS = {'salon_nail': 'boutique', 'clinic_wait': 'spa_yoga', 'book_cafe': 'study_cafe', 'hotel_lobby': 'wine_bar',
               'brunch_cafe': 'morning_bakery', 'flower_shop': 'hangang_picnic', 'golf_range': 'gym_cardio', 'camping': 'dawn_mood'}


def hash31(s: str) -> int:
    h = 17
    for ch in s:
        h = (h * 31 + ord(ch)) & 0x7FFFFFFF
    return h


def pool_of(tags, genre) -> str:
    for c in tags or []:
        k = str(c).replace('#', '').lower()
        if k in COVER_POOLS:
            return k
        if k in COVER_ALIAS:
            return COVER_ALIAS[k]
    g = str(genre or '')
    for word, pool in (('로파이', 'rainy_lofi'), ('시티팝', 'night_drive'), ('재즈', 'wine_bar'), ('트로트', 'pocha_night'),
                       ('레게', 'summer_beach'), ('트로피컬', 'summer_beach'), ('어쿠스틱', 'hangang_picnic'),
                       ('포크', 'hangang_picnic'), ('피아노', 'dawn_mood')):
        if word in g:
            return pool
    return 'mix'


def og_image(track_id, tags, genre) -> str:
    pool = pool_of(tags, genre)
    i = hash31('srv-' + track_id) % COVER_POOLS[pool] + 1
    return f'{SITE}/og/{pool}/{i:02d}.jpg'


PAGE = '''<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · {artist} | YARR</title>
<meta name="description" content="{desc}">
<meta property="og:type" content="music.song">
<meta property="og:site_name" content="YARR · AI 음악 차트">
<meta property="og:title" content="🎧 {title} — {artist}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="YARR AI 음악 차트 · AI로 만든 노래">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="{url}">
<link rel="icon" type="image/png" href="/favicon.png">
<meta name="theme-color" content="#090A0F">
<style>body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#090A0F;color:#F4F5F8;font:16px -apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;text-align:center}}a{{color:#FF8A4C;font-weight:700}}</style>
</head>
<body>
<p>🎧 {title} — {artist}<br><small>AI로 만든 노래</small><br><br><a href="{listen}">YARR에서 바로 듣기</a></p>
<script>location.replace({listen_js});</script>
</body>
</html>
'''


def page(t: dict, artist: str) -> str:
    tid = t['id']
    title = (t.get('title') or 'YARR 곡').strip()
    genre = (t.get('genre') or '').strip()
    kind = '연주곡' if t.get('is_instrumental') else 'AI로 만든 노래'
    desc = ' · '.join(x for x in (artist, genre, kind) if x) + ' | YARR AI 음악 차트에서 설치 없이 바로 듣기'
    listen = f'/listen.html?t={tid}'
    e = lambda s: html.escape(s, quote=True)
    return PAGE.format(title=e(title), artist=e(artist), desc=e(desc), url=f'{SITE}/s/{tid}',
                       img=og_image(tid, t.get('situation_tags'), genre), listen=e(listen), listen_js='"' + listen + '"')


UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')


def main():
    sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SECRET_KEY'])
    now = datetime.now(timezone.utc).isoformat()
    rows, start = [], 0
    while True:
        part = (sb.table('tracks')
                .select('id,title,genre,situation_tags,creator_id,is_instrumental,publish_at,creator_hidden')
                .eq('status', 'ACTIVE').order('created_at').range(start, start + 999).execute().data) or []
        rows += part
        if len(part) < 1000:
            break
        start += 1000
    rows = [r for r in rows if not r.get('creator_hidden') and (not r.get('publish_at') or r['publish_at'] <= now)]

    names = {}
    ids = sorted({r['creator_id'] for r in rows if r.get('creator_id')})
    for i in range(0, len(ids), 200):
        for u in (sb.table('users').select('id,nickname').in_('id', ids[i:i + 200]).execute().data) or []:
            names[u['id']] = (u.get('nickname') or '').strip()

    os.makedirs(OUT, exist_ok=True)
    keep, wrote = set(), 0
    for r in rows:
        if not UUID.match(str(r['id'])):
            continue
        name = f"{r['id']}.html"
        keep.add(name)
        body = page(r, names.get(r.get('creator_id')) or 'YARR 크리에이터')
        path = os.path.join(OUT, name)
        old = open(path, encoding='utf-8').read() if os.path.exists(path) else None
        if old != body:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(body)
            wrote += 1
    removed = 0
    for name in os.listdir(OUT):
        if name.endswith('.html') and name not in keep:
            os.remove(os.path.join(OUT, name))
            removed += 1
    print(f'공개 곡 {len(keep)} · 새로 쓴 페이지 {wrote} · 지운 페이지 {removed}')


if __name__ == '__main__':
    main()
