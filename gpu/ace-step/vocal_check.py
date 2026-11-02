"""목소리 확인 (2026-11-02): ACE-Step 가 가끔 가사를 빼먹고 반주만 만들어요.
앞 90초를 받아 적어서 넣은 가사(두 글자 묶음) 중 들린 비율을 JSON 한 줄로 출력해요.
ACE-Step 의 가상환경과 패키지가 섞이지 않게 이미지 기본 파이썬(/opt/conda)에서 따로 돌려요.
  사용: python vocal_check.py <음원 경로> <가사 파일 경로> <ko|en|ja>"""
import json
import re
import subprocess
import sys
import time


def letters(text: str) -> str:
    text = re.sub(r'\[[^\]]*\]', ' ', text or '')
    return re.sub(r'[^0-9a-z가-힣぀-ヿ一-鿿]', '', text.lower())


def main() -> None:
    path, lyr_path, lang = sys.argv[1], sys.argv[2], sys.argv[3]
    t0 = time.time()
    import numpy as np
    from faster_whisper import WhisperModel
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-t', '90', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'],
                       capture_output=True, check=False)
    audio = np.frombuffer(r.stdout, dtype=np.float32)
    if audio.size < 16000:
        print(json.dumps(None))
        return
    model = WhisperModel('base', device='cpu', compute_type='int8', download_root='/opt/whisper')
    segs, _ = model.transcribe(audio, language=lang if lang in ('ko', 'en', 'ja') else None, beam_size=1,
                               vad_filter=False, condition_on_previous_text=False)
    heard = ' '.join(x.text.strip() for x in segs if (x.no_speech_prob or 0) < 0.8)
    a, b = letters(open(lyr_path, encoding='utf-8').read()), letters(heard)
    want = {a[i:i + 2] for i in range(len(a) - 1)}
    got = {b[i:i + 2] for i in range(len(b) - 1)}
    match = round(len(want & got) / len(want), 3) if want else 0.0
    print(json.dumps({'match': match, 'chars': len(b), 'heard': heard[:120], 'took': round(time.time() - t0, 1)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
