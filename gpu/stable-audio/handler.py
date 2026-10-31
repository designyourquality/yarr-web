"""YARR 연주곡 GPU 서버 (RunPod Serverless) · Stable Audio 3 Medium (공개 모델)

서버 함수(house-music)가 이렇게 불러요:
  POST https://api.runpod.ai/v2/<엔드포인트 id>/run   {"input": {"prompt", "negative_prompt", "duration", "format": "mp3"}}
  GET  https://api.runpod.ai/v2/<엔드포인트 id>/status/<id>  →  {"status": "COMPLETED", "output": {"audio_b64": "<mp3 base64>", ...}}
결과 음원은 base64 mp3 로 돌려주고, 저장소에 올리는 건 서버 함수가 해요 (이 서버에는 Supabase 키를 두지 않아요).

환경 변수 (RunPod → 엔드포인트 → Environment Variables / Secrets)
  HF_TOKEN       Hugging Face 토큰 (stabilityai/stable-audio-3-medium 이용 동의 후 발급 · 채팅에 붙여 넣지 마세요)
  HF_HOME        모델 캐시 위치 (기본 /runpod-volume/hf · 네트워크 볼륨을 붙이면 다음 시작부터 다시 받지 않아요)
  SA3_VARIANT    기본 medium
  MAX_SECONDS    한 곡 최대 길이 (기본 200초)
  MP3_KBPS       기본 192
"""
from __future__ import annotations

import base64
import os
import subprocess
import tempfile
import time

MAX_SECONDS = int(os.environ.get('MAX_SECONDS', '200'))
MP3_KBPS = int(os.environ.get('MP3_KBPS', '192'))
VARIANT = os.environ.get('SA3_VARIANT', 'medium')
_MODEL = None


def load_model():
    """처음 한 번만 불러요 (같은 작업자는 다음 요청부터 바로 만들어요)"""
    global _MODEL
    if _MODEL is None:
        from stable_audio_3 import StableAudioModel   # pip: git+https://github.com/Stability-AI/stable-audio-3
        _MODEL = StableAudioModel.from_pretrained(VARIANT)
    return _MODEL


def clean_input(inp: dict) -> dict:
    """요청 값 확인 (서버 함수가 조립한 프롬프트만 와요 · 그래도 한 번 더 막아요)"""
    if not isinstance(inp, dict):
        raise ValueError('input 이 없어요')
    prompt = str(inp.get('prompt') or '').strip()
    if not 3 <= len(prompt) <= 800:
        raise ValueError('prompt 는 3~800자')
    neg = str(inp.get('negative_prompt') or '').strip()[:300]
    try:
        duration = int(round(float(inp.get('duration') or 150)))
    except (TypeError, ValueError):
        duration = 150
    duration = max(30, min(MAX_SECONDS, duration))
    seed = inp.get('seed')
    seed = int(seed) if isinstance(seed, (int, float, str)) and str(seed).lstrip('-').isdigit() else None
    return {'prompt': prompt, 'negative_prompt': neg, 'duration': duration, 'seed': seed}


def _sample_rate(model, fallback: int = 44100) -> int:
    for attr in ('sample_rate', 'sampling_rate'):
        v = getattr(model, attr, None)
        if isinstance(v, int) and v > 0:
            return v
    cfg = getattr(model, 'config', None) or getattr(model, 'model_config', None)
    if isinstance(cfg, dict) and isinstance(cfg.get('sample_rate'), int):
        return cfg['sample_rate']
    return fallback


def to_frames(audio):
    """모델 결과(텐서 · 배열 · (음원, 샘플레이트))를 (샘플 수, 채널) float32 배열로"""
    import numpy as np
    sr = None
    if isinstance(audio, (tuple, list)) and len(audio) == 2 and isinstance(audio[1], int):
        audio, sr = audio
    if hasattr(audio, 'detach'):
        audio = audio.detach().float().cpu().numpy()
    x = np.asarray(audio, dtype=np.float32)
    while x.ndim > 2:          # (배치, 채널, 샘플) → 첫 곡
        x = x[0]
    if x.ndim == 1:
        x = x[:, None]
    elif x.shape[0] <= 8 and x.shape[1] > x.shape[0]:   # (채널, 샘플) → (샘플, 채널)
        x = x.T
    peak = float(np.max(np.abs(x))) if x.size else 0.0
    if peak > 1.0:             # 넘치면 살짝 줄여요 (음량 맞춤은 자동 검수 워커가 해요)
        x = x / peak * 0.98
    return x, sr


def encode_mp3(frames, sr: int, kbps: int = MP3_KBPS) -> bytes:
    import soundfile as sf
    with tempfile.TemporaryDirectory() as tmp:
        wav, mp3 = os.path.join(tmp, 'a.wav'), os.path.join(tmp, 'a.mp3')
        sf.write(wav, frames, sr, subtype='FLOAT')
        r = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', f'{kbps}k', mp3], capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f'mp3 변환 실패: {r.stderr[:200]}')
        with open(mp3, 'rb') as f:
            return f.read()


def generate(model, p: dict):
    kw = {'prompt': p['prompt'], 'duration': p['duration']}
    if p.get('seed') is not None:
        kw['seed'] = p['seed']
    if p.get('negative_prompt'):
        try:
            return model.generate(**kw, negative_prompt=p['negative_prompt'])
        except TypeError:   # 모델 버전에 따라 negative_prompt · seed 를 안 받을 수 있어요
            pass
    try:
        return model.generate(**kw)
    except TypeError:
        kw.pop('seed', None)
        return model.generate(**kw)


def handler(job: dict) -> dict:
    t0 = time.time()
    p = clean_input(job.get('input'))
    model = load_model()
    frames, sr = to_frames(generate(model, p))
    sr = sr or _sample_rate(model)
    data = encode_mp3(frames, sr)
    return {
        'audio_b64': base64.b64encode(data).decode('ascii'),
        'format': 'mp3',
        'seconds': round(frames.shape[0] / sr, 1),
        'sample_rate': sr,
        'took': round(time.time() - t0, 1),
        'model': f'stable-audio-3-{VARIANT}',
    }


if __name__ == '__main__':
    import runpod
    if os.environ.get('PRELOAD', '1') == '1':
        load_model()   # 작업자가 켜질 때 미리 불러 두면 첫 요청이 빨라요
    runpod.serverless.start({'handler': handler})
