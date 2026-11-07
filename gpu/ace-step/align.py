"""구간 찾기 (2026-11-07): 곡 전체를 받아 적어 노래 줄이 몇 초에 나오는지 JSON 한 줄로 출력해요.
서버 함수가 이 시간으로 1절 · 후렴 · 브릿지 버튼의 정확한 시작/끝을 맞춰요.
ACE-Step 가상환경과 섞이지 않게 이미지 기본 파이썬(/opt/conda)에서 따로 돌려요 (vocal_check.py 와 같은 모델).
  사용: python align.py <음원 경로> <ko|en|ja>  →  {"segments": [[시작초, 끝초, "받아 적은 글"], ...], "took": 초}"""
import json
import subprocess
import sys
import time


def main() -> None:
    path, lang = sys.argv[1], sys.argv[2]
    t0 = time.time()
    import numpy as np
    from faster_whisper import WhisperModel
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-t', '300', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'],
                       capture_output=True, check=False)
    audio = np.frombuffer(r.stdout, dtype=np.float32)
    if audio.size < 16000:
        print(json.dumps({'segments': [], 'took': 0}))
        return
    model = WhisperModel('base', device='cpu', compute_type='int8', download_root='/opt/whisper')
    segs, _ = model.transcribe(audio, language=lang if lang in ('ko', 'en', 'ja') else None, beam_size=1,
                               vad_filter=True, condition_on_previous_text=False)
    out = [[round(x.start, 2), round(x.end, 2), x.text.strip()[:80]] for x in segs
           if (x.no_speech_prob or 0) < 0.8 and x.text.strip()]
    print(json.dumps({'segments': out[:400], 'took': round(time.time() - t0, 1)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
