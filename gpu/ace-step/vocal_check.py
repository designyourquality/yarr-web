"""곡 품질 확인 (2026-11-20 v2 · 대표님 청음 15곡으로 영점 맞춤)

1) 사고 검사 (quality_check.py · 모든 곡): 뚝 끊김 · 중간 무음 · 찢어짐 · 먹먹함 · 도돌이표 가사
2) 발음 (보컬곡): whisper small 로 원곡 '전체'를 받아 적고, 넣은 가사 줄마다 가장 비슷한 곳을 찾아 0~1 점수
     hit  = 60% 넘게 맞은 줄의 비율 · mean = 줄 점수 평균
     🟢 green  : hit ≥ 0.60 그리고 mean ≥ 0.55   (잘 들림 11곡 모두)
     🔴 red    : hit < 0.15 또는 mean < 0.30     (다른 곡 가사를 넣은 대조군만 · 실제 곡 0곡)
     🟡 yellow : 그 사이                          (반쯤 들림 4곡 모두)
     worst = 가장 낮은 두 줄 + 그 줄이 들린(듯한) 시간 → 운영팀이 그 부분만 바로 들어 봐요
   보컬 분리(Demucs)는 쓰지 않아요: 분리하면 오히려 점수가 틀어졌어요 (2026-11-20 비교).
3) 완성도 (--ce · 운영팀 곡만): Audiobox Aesthetics(CC-BY 4.0) 곡 전체 '즐거움(CE)' · 참고용 (자동 폐기에 안 써요)

ACE-Step 가상환경과 섞이지 않게 이미지 기본 파이썬(/opt/conda)에서 따로 돌려요.
  사용: python vocal_check.py <음원> <가사 파일 | -> <ko|en|ja> [--ce]
  출력: JSON 한 줄 {"match": hit, "mean", "verdict", "worst": [...], "lines", "chars", "qc": {...}, "ce", "took"}
        가사가 없으면(연주곡) {"qc": {...}} 만."""
import json
import os
import re
import subprocess
import sys
import time
from difflib import SequenceMatcher

GREEN_HIT, GREEN_MEAN = 0.60, 0.55
RED_HIT, RED_MEAN = 0.15, 0.30
LINE_OK = 0.6
MAX_SEC = 300


def verdict(hit: float, mean: float) -> str:
    if hit < RED_HIT or mean < RED_MEAN:
        return 'red'
    if hit >= GREEN_HIT and mean >= GREEN_MEAN:
        return 'green'
    return 'yellow'


_kks = None


def norm(text: str, ja: bool) -> str:
    """비교용 글자만: [구간 표시] · (추임새) 빼고, 일본어는 한자를 히라가나로"""
    global _kks
    text = re.sub(r'\[[^\]]*\]|\([^)]*\)|（[^）]*）', ' ', text or '')
    if ja:
        try:
            if _kks is None:
                import pykakasi
                _kks = pykakasi.kakasi()
            text = ''.join(x['hira'] for x in _kks.convert(text))
        except Exception:  # noqa: BLE001  변환기가 없으면 글자 그대로 (가나는 그대로 맞아요)
            pass
    return re.sub(r'[^0-9a-z가-힣ぁ-ゖァ-ヺ一-鿿]', '', text.lower())


def lyric_lines(lyrics: str) -> list[str]:
    out = []
    for raw in re.sub(r'\[[^\]]*\]', '\n', lyrics or '').split('\n'):
        s = raw.strip()
        if s and s not in out:
            out.append(s)
    return out


def pcm16k(path: str):
    import numpy as np
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-t', str(MAX_SEC), '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'],
                       capture_output=True, check=False)
    return np.frombuffer(r.stdout, dtype=np.float32)


def load_whisper():
    """영점을 맞춘 그대로 CPU int8 (GPU float16 은 받아쓰기가 달라질 수 있어요 · YARR_WHISPER_DEVICE=cuda 로 바꿀 수 있어요)"""
    from faster_whisper import WhisperModel
    if os.environ.get('YARR_WHISPER_DEVICE') == 'cuda':
        try:
            return WhisperModel('small', device='cuda', compute_type='float16', download_root='/opt/whisper')
        except Exception:  # noqa: BLE001
            pass
    return WhisperModel('small', device='cpu', compute_type='int8', cpu_threads=max(1, min(16, os.cpu_count() or 4)),
                        download_root='/opt/whisper')


def transcribe(audio, lang: str):
    """→ (받아 적은 글자열, 글자마다 시간(초), 구간 문장 목록)
    word_timestamps 는 쓰지 않아요: 켜면 받아쓰기 자체가 달라져 영점(청음 15곡)이 틀어졌어요 (토닥토닥 1.0 → 0.09).
    글자 시간은 구간(segment) 시작~끝을 글자 수로 나눠 어림해요 (그 줄 근처로 바로 가서 듣는 용도)."""
    model = load_whisper()
    segs, _ = model.transcribe(audio, language=lang if lang in ('ko', 'en', 'ja') else None, beam_size=5,
                               vad_filter=False, condition_on_previous_text=False)
    ja = lang == 'ja'
    chars, times, sents = [], [], []
    for s in segs:
        if (s.no_speech_prob or 0) >= 0.8:
            continue
        sents.append(s.text.strip())
        t = norm(s.text, ja)
        for k, c in enumerate(t):
            chars.append(c)
            times.append(s.start + (s.end - s.start) * k / max(1, len(t)))
    return ''.join(chars), times, sents


def score_lines(lines: list[str], heard: str, times: list[float], ja: bool) -> list[dict]:
    out = []
    for line in lines:
        u = norm(line, ja)
        if len(u) < 2:
            continue
        n = len(u)
        best, at = 0.0, 0
        for i in range(0, max(1, len(heard) - n + 1), max(1, n // 4)):
            r = SequenceMatcher(None, u, heard[i:i + n + 2], autojunk=False).ratio()
            if r > best:
                best, at = r, i
        t0 = times[at] if times and at < len(times) else None
        t1 = times[min(len(times) - 1, at + n - 1)] if times else None
        out.append({'text': line[:80], 'score': round(best, 3),
                    't0': round(t0, 1) if t0 is not None else None, 't1': round(t1, 1) if t1 is not None else None})
    return out


def aesthetics(path: str) -> float | None:
    """Audiobox Aesthetics 곡 전체 CE (0~10) · 실패하면 None"""
    try:
        from audiobox_aesthetics.infer import initialize_predictor
        r = initialize_predictor().forward([{'path': path}])
        return round(float(r[0]['CE']), 3)
    except Exception as e:  # noqa: BLE001
        print(f'ce skip: {e!r}'[:200], file=sys.stderr)
        return None


def main() -> None:
    path, lyr_path, lang = sys.argv[1], sys.argv[2], sys.argv[3]
    want_ce = '--ce' in sys.argv[4:]
    t0 = time.time()
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        import yarr_quality_check as qcmod
    except ImportError:
        import quality_check as qcmod
    lyrics = '' if lyr_path == '-' else open(lyr_path, encoding='utf-8').read()
    lines = lyric_lines(lyrics)
    out: dict = {}
    sents: list[str] | None = None
    if lines:
        audio = pcm16k(path)
        if audio.size < 16000:
            print(json.dumps(None))
            return
        ja = lang == 'ja'
        heard, times, sents = transcribe(audio, lang)
        sc = score_lines(lines, heard, times, ja)
        if sc:
            hit = round(sum(x['score'] >= LINE_OK for x in sc) / len(sc), 3)
            mean = round(sum(x['score'] for x in sc) / len(sc), 3)
            out.update({'match': hit, 'mean': mean, 'verdict': verdict(hit, mean),
                        'worst': sorted(sc, key=lambda x: x['score'])[:2], 'lines': len(sc)})
        else:
            out.update({'match': 0.0, 'mean': 0.0, 'verdict': None, 'worst': [], 'lines': 0})
        out.update({'chars': len(heard), 'heard': ' '.join(sents)[:120], 'v': 2})
    try:
        out['qc'] = qcmod.check(path, lyrics, sents)
    except Exception as e:  # noqa: BLE001  사고 검사를 못 해도 곡은 그대로
        print(f'qc skip: {e!r}'[:200], file=sys.stderr)
    if want_ce:
        out['ce'] = aesthetics(path)
    out['took'] = round(time.time() - t0, 1)
    print(json.dumps(out, ensure_ascii=False))


if __name__ == '__main__':
    main()
