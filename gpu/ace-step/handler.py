"""YARR 보컬곡 GPU 서버 (RunPod Serverless) · ACE-Step 1.5 (MIT · 가사로 노래하는 공개 모델)

서버 함수(house-music)가 이렇게 불러요:
  POST https://api.runpod.ai/v2/<엔드포인트 id>/run
       {"input": {"caption": "korean trot, female vocal, ...", "lyrics": "[Verse]\\n...", "duration": 150,
                  "vocal_language": "ko", "bpm": 120, "seed": 123, "instrumental": false}}
  GET  https://api.runpod.ai/v2/<엔드포인트 id>/status/<id>  →  {"status": "COMPLETED", "output": {"audio_b64": "<mp3 base64>", ...}}
결과는 base64 mp3 로 돌려주고, 저장소에 올리는 건 서버 함수가 해요 (이 서버에는 Supabase 키를 두지 않아요).

커버(직접 찍기 실험): {"input": {..., "src_audio_b64": "<mp3/wav base64 · 8MB 이하>", "cover_strength": 0.55}}
  → ACE-Step 의 cover 작업: 가이드 음원의 멜로디 · 리듬 · 코드 구조를 따라 caption · lyrics 대로 새로 만들어요.
     cover_strength 1.0 = 구조를 꽉 따름 · 0.5 = 반반 · 0.2 = 느슨하게 (곡 길이는 가이드 길이를 따라요)

환경 변수 (RunPod → 엔드포인트)
  HF_TOKEN            Hugging Face 토큰 (Secret 으로 · 공개 모델이라 없어도 되지만 받기가 빨라요)
  ACE_DIT             기본 acestep-v15-turbo (8단계 · 빠름)
  ACE_LM              기본 acestep-5Hz-lm-1.7B (곡 구조 · 가사 정렬 담당)
  ACE_CKPT            모델을 둘 쓰기 가능한 폴더 (기본 /tmp/ace_ckpt)
  RUNPOD_HF_CACHE     RunPod 'Cached model' 위치 (기본 /runpod-volume/huggingface-cache/hub)
                      → Cached model 에 ACE-Step/Ace-Step1.5 를 넣으면 처음 켜질 때 다시 받지 않아요
  MAX_SECONDS         한 곡 최대 길이 (기본 240초) · MP3_KBPS 기본 192
"""
from __future__ import annotations

import base64
import os
import shutil
import subprocess
import tempfile
import time

MAX_SECONDS = int(os.environ.get('MAX_SECONDS', '240'))
MP3_KBPS = int(os.environ.get('MP3_KBPS', '192'))
DIT = os.environ.get('ACE_DIT', 'acestep-v15-turbo')
LM = os.environ.get('ACE_LM', 'acestep-5Hz-lm-1.7B')
CKPT = os.environ.get('ACE_CKPT', '/tmp/ace_ckpt')
RUNPOD_HF_CACHE = os.environ.get('RUNPOD_HF_CACHE', '/runpod-volume/huggingface-cache/hub')
MAIN_REPO_DIR = 'models--ACE-Step--Ace-Step1.5'
LANGS = {'ko', 'en', 'ja', 'zh', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'unknown'}

_DIT = None
_LLM = None


def shadow_cached_checkpoints() -> bool:
    """RunPod 가 미리 받아 둔 모델(읽기 전용)을 쓰기 가능한 폴더에 '그림자'로 만들어요.
    큰 가중치 파일은 링크만 걸고, ACE-Step 이 시작할 때 덮어쓰는 .py 파일만 복사해요 → 10GB 를 다시 받지 않아요."""
    snaps = os.path.join(RUNPOD_HF_CACHE, MAIN_REPO_DIR, 'snapshots')
    if not os.path.isdir(snaps):
        return False
    revs = sorted(os.listdir(snaps))
    if not revs:
        return False
    src_root = os.path.join(snaps, revs[-1])
    for dirpath, _dirs, files in os.walk(src_root, followlinks=True):
        rel = os.path.relpath(dirpath, src_root)
        dst_dir = os.path.normpath(os.path.join(CKPT, rel))
        os.makedirs(dst_dir, exist_ok=True)
        for f in files:
            src, dst = os.path.join(dirpath, f), os.path.join(dst_dir, f)
            if os.path.lexists(dst):
                continue
            if f.endswith('.py') or f.endswith('.json'):
                shutil.copyfile(os.path.realpath(src), dst)   # 작은 파일: 복사 (덮어써도 되게)
            else:
                os.symlink(os.path.realpath(src), dst)        # 큰 가중치: 링크
    return True


def load_models():
    """처음 한 번만 불러요 (같은 작업자는 다음 요청부터 바로 만들어요)"""
    global _DIT, _LLM
    if _DIT is not None:
        return _DIT, _LLM
    os.makedirs(CKPT, exist_ok=True)
    os.environ['ACESTEP_CHECKPOINTS_DIR'] = CKPT
    if shadow_cached_checkpoints():
        print('미리 받아 둔 ACE-Step 모델 사용', flush=True)
    from acestep.handler import AceStepHandler
    from acestep.llm_inference import LLMHandler
    from acestep.model_downloader import ensure_lm_model, ensure_main_model

    token = os.environ.get('HF_TOKEN') or None
    ok, msg = ensure_main_model(checkpoints_dir=__import__('pathlib').Path(CKPT), token=token, prefer_source='huggingface')
    if not ok:
        raise RuntimeError(f'모델 받기 실패: {msg}')
    ok, msg = ensure_lm_model(LM, checkpoints_dir=__import__('pathlib').Path(CKPT), token=token, prefer_source='huggingface')
    if not ok:
        raise RuntimeError(f'LM 받기 실패: {msg}')

    dit = AceStepHandler()
    status, ok = dit.initialize_service(project_root=os.path.dirname(CKPT), config_path=DIT, device='cuda')
    if not ok:
        raise RuntimeError(f'DiT 준비 실패: {status}')
    llm = LLMHandler()
    status, ok = llm.initialize(checkpoint_dir=CKPT, lm_model_path=LM, backend='pt', device='cuda')
    if not ok:
        raise RuntimeError(f'LM 준비 실패: {status}')
    _DIT, _LLM = dit, llm
    return dit, llm


def clean_input(inp: dict) -> dict:
    """요청 값 확인 (서버 함수가 조립한 값만 와요 · 그래도 한 번 더 막아요)"""
    if not isinstance(inp, dict):
        raise ValueError('input 이 없어요')
    caption = str(inp.get('caption') or inp.get('prompt') or '').strip()
    if not 3 <= len(caption) <= 600:
        raise ValueError('caption 은 3~600자')
    instrumental = bool(inp.get('instrumental'))
    lyrics = '' if instrumental else str(inp.get('lyrics') or '').strip()
    if not instrumental and not 5 <= len(lyrics) <= 3000:
        raise ValueError('lyrics 는 5~3000자 (연주곡이면 instrumental: true)')
    try:
        duration = int(round(float(inp.get('duration') or 150)))
    except (TypeError, ValueError):
        duration = 150
    duration = max(30, min(MAX_SECONDS, duration))
    lang = str(inp.get('vocal_language') or 'ko').strip().lower()
    lang = lang if lang in LANGS else 'unknown'
    bpm = inp.get('bpm')
    bpm = int(bpm) if isinstance(bpm, (int, float)) and 40 <= bpm <= 220 else None
    seed = inp.get('seed')
    seed = int(seed) if isinstance(seed, (int, float)) and seed >= 0 else -1
    src = inp.get('src_audio_b64')
    src_bytes = None
    if src:
        try:
            src_bytes = base64.b64decode(str(src), validate=False)
        except Exception as e:  # noqa: BLE001
            raise ValueError(f'src_audio_b64 를 읽지 못했어요: {e}')
        if not 1000 <= len(src_bytes) <= 8 * 1024 * 1024:
            raise ValueError('src_audio 는 1KB~8MB')
    strength = inp.get('cover_strength')
    strength = float(strength) if isinstance(strength, (int, float)) and 0.0 <= strength <= 1.0 else 0.55
    return {'caption': caption, 'lyrics': lyrics, 'instrumental': instrumental, 'duration': duration,
            'vocal_language': lang, 'bpm': bpm, 'seed': seed, 'src_bytes': src_bytes, 'cover_strength': strength}


def encode_mp3(path: str, kbps: int = MP3_KBPS) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        mp3 = os.path.join(tmp, 'a.mp3')
        r = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', path, '-codec:a', 'libmp3lame', '-b:a', f'{kbps}k', mp3],
                           capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f'mp3 변환 실패: {r.stderr[:200]}')
        with open(mp3, 'rb') as f:
            return f.read()


def handler(job: dict) -> dict:
    t0 = time.time()
    p = clean_input(job.get('input'))
    dit, llm = load_models()
    from acestep.inference import GenerationConfig, GenerationParams

    cover = p['src_bytes'] is not None
    src_dir = tempfile.mkdtemp() if cover else None
    src_path = None
    if cover:
        src_path = os.path.join(src_dir, 'guide.wav' if p['src_bytes'][:4] == b'RIFF' else 'guide.mp3')
        with open(src_path, 'wb') as f:
            f.write(p['src_bytes'])
    if cover:
        # 커버: LM 대신 가이드 음원이 곡 구조(멜로디 · 리듬 · 코드)를 정해요
        params = GenerationParams(
            task_type='cover', src_audio=src_path, audio_cover_strength=p['cover_strength'],
            caption=p['caption'], lyrics=p['lyrics'], instrumental=p['instrumental'],
            vocal_language=p['vocal_language'], bpm=p['bpm'], seed=p['seed'], inference_steps=8,
            thinking=False, use_cot_caption=False,
        )
    else:
        params = GenerationParams(
            task_type='text2music', caption=p['caption'], lyrics=p['lyrics'], instrumental=p['instrumental'],
            vocal_language=p['vocal_language'], bpm=p['bpm'], duration=float(p['duration']), seed=p['seed'],
            inference_steps=8, thinking=True,
            # LM 이 곡 설명을 고쳐 쓰지 않게 (고쳐 쓰면 '여자 보컬' 같은 지시가 빠질 때가 있어요) · 구조 · 박자 계획은 그대로 LM 이 해요
            use_cot_caption=False,
        )
    config = GenerationConfig(batch_size=1, use_random_seed=p['seed'] < 0,
                              seeds=None if p['seed'] < 0 else [p['seed']], audio_format='wav')
    try:
        with tempfile.TemporaryDirectory() as out:
            return _run(dit, llm, params, config, out, p, t0, cover)
    finally:
        if src_dir:
            shutil.rmtree(src_dir, ignore_errors=True)


def _run(dit, llm, params, config, out: str, p: dict, t0: float, cover: bool) -> dict:
    from acestep.inference import generate_music
    result = generate_music(dit, llm, params, config, save_dir=out)
    if not result.success or not result.audios:
        raise RuntimeError(f'만들기 실패: {result.error or result.status_message}')
    a = result.audios[0]
    data = encode_mp3(a['path'])
    seed = (a.get('params') or {}).get('seed')
    sr = a.get('sample_rate') or 48000
    t = a.get('tensor')
    seconds = round(t.shape[-1] / sr, 1) if t is not None else p['duration']
    return {
        'audio_b64': base64.b64encode(data).decode('ascii'),
        'format': 'mp3',
        'seconds': seconds,
        'sample_rate': sr,
        'seed': seed,
        'took': round(time.time() - t0, 1),
        'model': f'ace-step-1.5:{DIT}+{LM}',
        'task': 'cover' if cover else 'text2music',
        'cover_strength': p['cover_strength'] if cover else None,
    }


if __name__ == '__main__':
    import runpod
    if os.environ.get('PRELOAD', '1') == '1':
        load_models()   # 작업자가 켜질 때 미리 불러 두면 첫 요청이 빨라요
    runpod.serverless.start({'handler': handler})
