"""YARR 스템 나누기 (2026-11-04): Demucs htdemucs 로 보컬 · 반주(나머지 전부) 두 갈래로 나눠요.

ACE-Step 가상환경이 아니라 이미지 기본 파이썬(/opt/conda)에서 따로 돌려요 (ACE 패키지를 건드리지 않게).
쓰는 법: python yarr_stems.py <입력 mp3/wav> <출력 폴더>  →  <출력 폴더>/vocals.wav · backing.wav
"""
import sys

import numpy as np
import soundfile as sf
import torch
from demucs.apply import apply_model
from demucs.audio import AudioFile
from demucs.pretrained import get_model


def main(src: str, out: str) -> None:
    model = get_model('htdemucs')
    model.eval()
    dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    model.to(dev)
    wav = AudioFile(src).read(streams=0, samplerate=model.samplerate, channels=model.audio_channels)
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / (ref.std() + 1e-8)
    with torch.no_grad():
        sources = apply_model(model, wav[None], device=dev, shifts=1, split=True, overlap=0.25, progress=False)[0]
    sources = sources * (ref.std() + 1e-8) + ref.mean()
    names = list(model.sources)   # ['drums', 'bass', 'other', 'vocals']
    vi = names.index('vocals')
    vocals = sources[vi]
    backing = sum(sources[i] for i in range(len(names)) if i != vi)
    for name, x in (('vocals', vocals), ('backing', backing)):
        a = x.cpu().numpy().T.astype(np.float32)
        peak = float(np.abs(a).max()) or 1.0
        if peak > 0.99:
            a = a * (0.99 / peak)   # 합칠 때 넘친 부분만 살짝 줄여요
        sf.write(f'{out}/{name}.wav', a, model.samplerate)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
