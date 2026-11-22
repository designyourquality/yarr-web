"""YARR 보컬곡 전체 점검 (2026-11-22 · 읽기 전용)

공개(ACTIVE) 곡 중 가사가 있는 곡을 하나씩 받아서 품질 v2 검사(vocal_check.py)를 돌려요.
  - 발음: whisper small 로 전곡 받아쓰기 → 가사 줄마다 0~1 → 🟢/🟡/🔴 · 약한 두 줄 + 시간
  - 사고: 뚝 끊김 · 중간 무음 · 찢어짐 · 먹먹함
DB 에는 아무것도 쓰지 않아요. 결과는 Artifacts 'vocal-audit' (shard_N.json) 로만 남아요.
  사용: python worker/vocal_audit.py <shard> <shards>
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def sb():
    from supabase import create_client
    return create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SECRET_KEY'])


def lang_of(lyrics: str) -> str:
    t = re.sub(r'\[[^\]]*\]', '', lyrics or '')
    ko = len(re.findall(r'[가-힣]', t))
    ja = len(re.findall(r'[ぁ-ゖァ-ヺ]', t))
    en = len(re.findall(r'[A-Za-z]', t))
    if ja > ko and ja > en / 3:
        return 'ja'
    if ko >= en / 3:
        return 'ko'
    return 'en'


def fetch(client, url: str, dst: str) -> bool:
    if url.startswith('storage:uploads/'):
        with open(dst, 'wb') as f:
            f.write(client.storage.from_('uploads').download(url[len('storage:uploads/'):]))
        return True
    if url.startswith('http'):
        import requests
        r = requests.get(url, timeout=120)
        r.raise_for_status()
        open(dst, 'wb').write(r.content)
        return True
    m = re.match(r'storage:([^/]+)/(.+)', url)
    if m:
        with open(dst, 'wb') as f:
            f.write(client.storage.from_(m.group(1)).download(m.group(2)))
        return True
    return False


def main() -> None:
    shard, shards = int(sys.argv[1]), int(sys.argv[2])
    c = sb()
    rows, start = [], 0
    while True:
        part = (c.table('tracks').select('id,title,lyrics,audio_url,created_at')
                .eq('status', 'ACTIVE').not_.is_('lyrics', 'null')
                .order('created_at').range(start, start + 499).execute().data) or []
        rows += part
        if len(part) < 500:
            break
        start += 500
    rows = [r for r in rows if len((r.get('lyrics') or '').strip()) > 20]
    mine = [r for i, r in enumerate(rows) if i % shards == shard]
    print(f'보컬곡 {len(rows)}곡 중 이 조각 {len(mine)}곡', flush=True)
    out = []
    for n, r in enumerate(mine, 1):
        t0 = time.time()
        rec = {'id': r['id'], 'title': r['title'], 'created_at': r['created_at'], 'audio': (r.get('audio_url') or '')[:20]}
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, 'a' + (os.path.splitext((r.get('audio_url') or '').split('?')[0])[1] or '.mp3'))
            lyr = os.path.join(tmp, 'l.txt')
            open(lyr, 'w', encoding='utf-8').write(r['lyrics'])
            try:
                if not fetch(c, r.get('audio_url') or '', src):
                    rec['error'] = 'audio_url 형식 모름'
                else:
                    lang = lang_of(r['lyrics'])
                    p = subprocess.run([sys.executable, os.path.join(HERE, 'vocal_check.py'), src, lyr, lang],
                                       capture_output=True, text=True, timeout=900)
                    line = (p.stdout.strip().splitlines() or ['null'])[-1]
                    rec.update({'lang': lang, 'check': json.loads(line)})
                    if p.returncode:
                        rec['error'] = p.stderr[-300:]
            except Exception as e:  # noqa: BLE001
                rec['error'] = str(e)[:300]
        ck = rec.get('check') or {}
        print(f"[{n}/{len(mine)}] {r['title'][:24]} → {ck.get('verdict')} {ck.get('match')} "
              f"{(ck.get('qc') or {}).get('faults')} {rec.get('error', '')[:60]} ({time.time() - t0:.0f}s)", flush=True)
        out.append(rec)
    os.makedirs('vocal_audit_out', exist_ok=True)
    json.dump(out, open(f'vocal_audit_out/shard_{shard}.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
