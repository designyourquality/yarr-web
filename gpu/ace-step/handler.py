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
직접 찍기(앱): {"input": {..., "guide": {"bpm": 100, "key": "C", "chords": ["C","G","Am","F"],
                                        "notes": [{"beat": 0, "pitch": 0, "len": 1}, ...], "drums": true},
                         "cover_strength": 0.55}}
  → 이 서버가 음표 · 코드로 가이드 음원을 바로 합성해서(yarr_guide.py · numpy) 커버로 만들어요.
     보컬곡은 가이드 멜로디 소리를 30% 줄여요 (크면 가사 대신 '뚜루루' 로 따라 불러요 · 2026-11-01 실험)
음질 옵션 (실험 · 빠지면 지금과 똑같이):
  "dit": "acestep-v15-turbo" | "acestep-v15-turbo-shift3" | "acestep-v15-xl-turbo" (처음 쓰면 받아서 같은 작업자에 올려 둬요)
  "shift": 1.0~5.0 (공식 문서는 turbo 에 3.0 권장) · "steps": 4~20 (turbo 기본 8)
  "master": true → 마지막 mp3 변환 때 쇳소리 대역(3.5~6kHz) -2dB · 중저음(150~300Hz) +1.5dB · 가벼운 압축
  "guide_melody": "all" | "gaps" (gaps = 멜로디는 전주 · 간주에만, 노래 구간은 코드만) · "guide_lowpass": true (가이드 2kHz 위를 깎아 전자음 질감이 덜 옮게)

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
_DITS: dict = {}
DIT_CHOICES = {'acestep-v15-turbo', 'acestep-v15-turbo-shift3', 'acestep-v15-xl-turbo'}
MASTER_AF = 'equalizer=f=4500:t=q:w=0.8:g=-2,equalizer=f=220:t=q:w=0.9:g=1.5,acompressor=threshold=-18dB:ratio=2:attack=20:release=250:makeup=1'


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
    _DITS[DIT] = dit
    return dit, llm


def _drop_extra_dits(keep: str | None = None) -> None:
    """24GB GPU 에서는 기본 모델 + XL 을 같이 올리면 메모리가 모자라요 (2026-11-01 음질 실험 · 커버 3곡 CUDA OOM)
    → 기본 모델 말고 올려 둔 모델은 내려요 (48GB 이상이면 그대로 둬요)"""
    import torch
    if torch.cuda.get_device_properties(0).total_memory >= 40 * 1024 ** 3:
        return
    dropped = False
    for k in [k for k in _DITS if k not in (DIT, keep)]:
        del _DITS[k]
        dropped = True
    if dropped:
        import gc
        gc.collect()
        torch.cuda.empty_cache()


def get_dit(name: str | None):
    """요청마다 다른 DiT (음질 실험) · 한 번 올린 모델은 같은 작업자에 남겨 둬요 (24GB GPU 는 하나만)"""
    dit, _ = load_models()
    if not name or name == DIT:
        _drop_extra_dits()
        return dit
    if name in _DITS:
        return _DITS[name]
    _drop_extra_dits(keep=name)
    from acestep.handler import AceStepHandler
    from acestep.model_downloader import ensure_dit_model
    ok, msg = ensure_dit_model(name, checkpoints_dir=__import__('pathlib').Path(CKPT), token=os.environ.get('HF_TOKEN') or None, prefer_source='huggingface')
    if not ok:
        raise RuntimeError(f'{name} 받기 실패: {msg}')
    h = AceStepHandler()
    status, ok = h.initialize_service(project_root=os.path.dirname(CKPT), config_path=name, device='cuda')
    if not ok:
        raise RuntimeError(f'{name} 준비 실패: {status}')
    _DITS[name] = h
    return h


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
    guide = None
    if inp.get('guide') is not None and not src_bytes:
        import yarr_guide
        guide = yarr_guide.check(inp.get('guide'))
        x = yarr_guide.render(guide, duration, melody_gain=1.0 if instrumental else 0.7,
                              melody_where='gaps' if inp.get('guide_melody') == 'gaps' else 'all', lowpass=inp.get('guide_lowpass') is True)
        src_bytes = yarr_guide.to_wav_bytes(x)
    strength = inp.get('cover_strength')
    strength = float(strength) if isinstance(strength, (int, float)) and 0.0 <= strength <= 1.0 else 0.55
    return {'caption': caption, 'lyrics': lyrics, 'instrumental': instrumental, 'duration': duration,
            'vocal_language': lang, 'bpm': bpm, 'seed': seed, 'src_bytes': src_bytes, 'cover_strength': strength,
            'guide': guide is not None,
            'dit': str(inp['dit']) if inp.get('dit') in DIT_CHOICES else None,
            'shift': float(inp['shift']) if isinstance(inp.get('shift'), (int, float)) and 1.0 <= inp['shift'] <= 5.0 else None,
            'steps': int(inp['steps']) if isinstance(inp.get('steps'), (int, float)) and 4 <= inp['steps'] <= 20 else 8,
            'master': inp.get('master') is True,
            # 조 고정 (실험 · 앞으로 직접 찍기 조 맞추기): 'C Major' · 'A Minor' · 'Am' 처럼 · 이상하면 무시
            'keyscale': str(inp['keyscale']) if isinstance(inp.get('keyscale'), str)
            and __import__('re').fullmatch(r'[A-G][#b]?(m| Major| Minor)?', inp['keyscale']) else ''}


def encode_mp3(path: str, kbps: int = MP3_KBPS, master: bool = False) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        mp3 = os.path.join(tmp, 'a.mp3')
        af = ['-af', MASTER_AF] if master else []
        r = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', path, *af, '-codec:a', 'libmp3lame', '-b:a', f'{kbps}k', mp3],
                           capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f'mp3 변환 실패: {r.stderr[:200]}')
        with open(mp3, 'rb') as f:
            return f.read()


def handler(job: dict) -> dict:
    t0 = time.time()
    p = clean_input(job.get('input'))
    _, llm = load_models()
    dit = get_dit(p['dit'])
    from acestep.inference import GenerationConfig, GenerationParams
    tune = {'inference_steps': p['steps'], **({'shift': p['shift']} if p['shift'] else {})}

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
            vocal_language=p['vocal_language'], bpm=p['bpm'], seed=p['seed'], **tune,
            thinking=False, use_cot_caption=False,
        )
    else:
        params = GenerationParams(
            task_type='text2music', caption=p['caption'], lyrics=p['lyrics'], instrumental=p['instrumental'],
            vocal_language=p['vocal_language'], bpm=p['bpm'], duration=float(p['duration']), seed=p['seed'],
            **tune, thinking=True, **({'keyscale': p['keyscale']} if p.get('keyscale') else {}),
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
    data = encode_mp3(a['path'], master=p.get('master', False))
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
        'guide': p.get('guide', False),
        'dit': p.get('dit') or DIT, 'shift': p.get('shift') or 1.0, 'steps': p.get('steps', 8), 'master': p.get('master', False),
        'keyscale': p.get('keyscale') or None,
    }


if __name__ == '__main__':
    import runpod
    if os.environ.get('PRELOAD', '1') == '1':
        load_models()   # 작업자가 켜질 때 미리 불러 두면 첫 요청이 빨라요
    runpod.serverless.start({'handler': handler})
