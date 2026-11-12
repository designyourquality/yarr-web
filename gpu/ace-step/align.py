"""구간 찾기 (2026-11-07): 곡 전체를 받아 적어 노래 줄이 몇 초에 나오는지 JSON 한 줄로 출력해요.
서버 함수가 이 시간으로 1절 · 후렴 · 브릿지 버튼의 정확한 시작/끝을 맞춰요.
ACE-Step 가상환경과 섞이지 않게 이미지 기본 파이썬(/opt/conda)에서 따로 돌려요 (vocal_check.py 와 같은 모델).
  사용: python align.py <음원 경로> <ko|en|ja>  →  {"segments": [[시작초, 끝초, "받아 적은 글"], ...], "took": 초}

가사 줄 맞추기 (2026-11-12 · 🎬 MV 가사 싱크): 받아쓰기(whisper base)는 노래를 거의 못 알아들어서 줄 시간이 엉망이었어요.
가사를 이미 알고 있으니 '받아 적기' 대신 '이 글자가 몇 초에 나오는지'만 찾아요 (강제 정렬 · torchaudio MMS_FA).
  1) Demucs 로 보컬만 분리 (반주가 섞이면 정확도가 떨어져요 · 실패하면 원곡 그대로)
  2) 가사를 로마자로 바꿔 (한글 자모 → 라틴 · 영어는 그대로 · 일본어 가나) 줄 사이에 '아무 소리' 칸(*)을 끼워 한 번에 맞춰요
  사용: python align.py <음원 경로> <ko|en|ja> <가사 줄 JSON 파일>
        →  {"lines": [[시작초, 끝초, 점수] 또는 null, ...], "vocals": true|false, "took": 초}
           (줄 순서 = 넣은 순서 · 점수 0~1 · 글자가 하나도 없는 줄은 null)
  강제 정렬이 실패하면 예전처럼 받아쓰기 결과(segments)를 돌려줘요."""
import json
import subprocess
import sys
import time

# 한글 음절 → 로마자 (MMS_FA 가 배운 표기(uroman)에 가깝게 · 소리 나는 대로가 아니라 글자 그대로)
_CHO = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h']
_JUNG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i']
_JONG = ['', 'g', 'kk', 'gs', 'n', 'nj', 'nh', 'd', 'l', 'lg', 'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'b', 'bs', 's', 'ss', 'ng', 'j', 'ch', 'k', 't', 'p', 'h']
_KANA = dict(zip(
    'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽぁぃぅぇぉゃゅょっー',
    ['a', 'i', 'u', 'e', 'o', 'ka', 'ki', 'ku', 'ke', 'ko', 'sa', 'shi', 'su', 'se', 'so', 'ta', 'chi', 'tsu', 'te', 'to',
     'na', 'ni', 'nu', 'ne', 'no', 'ha', 'hi', 'fu', 'he', 'ho', 'ma', 'mi', 'mu', 'me', 'mo', 'ya', 'yu', 'yo',
     'ra', 'ri', 'ru', 're', 'ro', 'wa', 'o', 'n', 'ga', 'gi', 'gu', 'ge', 'go', 'za', 'ji', 'zu', 'ze', 'zo',
     'da', 'ji', 'zu', 'de', 'do', 'ba', 'bi', 'bu', 'be', 'bo', 'pa', 'pi', 'pu', 'pe', 'po',
     'a', 'i', 'u', 'e', 'o', 'ya', 'yu', 'yo', '', '']))
_OK = set("abcdefghijklmnopqrstuvwxyz'")


def romanize(text: str) -> str:
    """가사 한 줄 → MMS_FA 글자(a~z · ')만 남긴 로마자. 괄호 속 애드리브 · 숫자 · 기호 · 한자는 빼요."""
    out = []
    depth = 0
    for ch in text:
        if ch in '([（［':
            depth += 1
            continue
        if ch in ')]）］':
            depth = max(0, depth - 1)
            continue
        if depth:
            continue
        o = ord(ch)
        if 0xAC00 <= o <= 0xD7A3:
            s = o - 0xAC00
            out.append(_CHO[s // 588] + _JUNG[(s % 588) // 28] + _JONG[s % 28])
        elif 0x30A1 <= o <= 0x30F6:   # 가타카나 → 히라가나 표로
            out.append(_KANA.get(chr(o - 0x60), ''))
        elif ch in _KANA:
            out.append(_KANA[ch])
        else:
            c = ch.lower()
            if c in _OK:
                out.append(c)
            elif c in '’`':
                out.append("'")
    return ''.join(out)


def _vocals_16k(path: str):
    """Demucs 로 보컬만 → 16kHz 모노 (실패하면 None)"""
    try:
        import torch
        import torchaudio
        from demucs.apply import apply_model
        from demucs.audio import AudioFile
        from demucs.pretrained import get_model
        model = get_model('htdemucs')
        model.eval()
        dev = 'cuda' if torch.cuda.is_available() else 'cpu'
        wav = AudioFile(path).read(streams=0, samplerate=model.samplerate, channels=model.audio_channels)
        wav = wav[:, : model.samplerate * 300]
        ref = wav.mean(0)
        wav = (wav - ref.mean()) / (ref.std() + 1e-8)

        def run(d):
            model.to(d)
            with torch.no_grad():
                return apply_model(model, wav[None], device=d, shifts=1, split=True, overlap=0.25, progress=False)[0]
        try:
            src = run(dev)
        except RuntimeError:   # GPU 메모리가 모자라면 CPU 로
            if dev == 'cpu':
                raise
            torch.cuda.empty_cache()
            src = run('cpu')
        v = src[list(model.sources).index('vocals')].mean(0).cpu()
        model.to('cpu')
        del src
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        return torchaudio.functional.resample(v, model.samplerate, 16000)
    except Exception as e:   # noqa: BLE001
        print(f'vocals skip: {e!r}'[:300], file=sys.stderr)
        return None


def _mix_16k(path: str):
    import numpy as np
    import torch
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-t', '300', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'],
                       capture_output=True, check=False)
    return torch.from_numpy(np.frombuffer(r.stdout, dtype=np.float32).copy())


def forced_lines(path: str, lines: list) -> dict:
    """가사 줄(부르는 순서) → 줄마다 [시작, 끝, 점수]"""
    import torch
    import torchaudio
    import torchaudio.functional as F
    roman = [romanize(str(x)) for x in lines]
    if sum(1 for r in roman if r) < 2:
        raise ValueError('맞출 글자가 없어요')
    wav = _vocals_16k(path)
    vocals = wav is not None
    if wav is None:
        wav = _mix_16k(path)
    if wav.numel() < 16000:
        raise ValueError('음원이 너무 짧아요')
    peak = float(wav.abs().max()) or 1.0
    wav = wav / peak * 0.9
    try:   # 이미지의 오래된 인증서 목록 대신 certifi (모델 받기가 'certificate has expired' 로 실패했어요 · 2026-11-12)
        import os
        import certifi
        os.environ.setdefault('SSL_CERT_FILE', certifi.where())
    except Exception:   # noqa: BLE001
        pass
    bundle = torchaudio.pipelines.MMS_FA
    labels = bundle.get_labels(star=None)
    dic = {c: i for i, c in enumerate(labels)}
    star = len(labels)

    def emit(dev):
        model = bundle.get_model(with_star=False).to(dev).eval()
        # 30초씩 (앞뒤 2초 겹쳐서 가장자리는 버려요) — 한 번에 넣으면 메모리가 곡 길이의 제곱으로 들어요
        sr, win, ctx, hop = 16000, 30, 2, 320
        outs = []
        with torch.inference_mode():
            for s in range(0, wav.numel(), win * sr):
                a, b = max(0, s - ctx * sr), min(wav.numel(), s + (win + ctx) * sr)
                e, _ = model(wav[a:b][None].to(dev))
                e = torch.log_softmax(e[0].float(), dim=-1).cpu()
                lo = (s - a) // hop
                hi = lo + min(win * sr, wav.numel() - s) // hop
                outs.append(e[lo:hi])
        del model
        return torch.cat(outs, 0)
    dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    try:
        em = emit(dev)
    except RuntimeError:
        if dev == 'cpu':
            raise
        torch.cuda.empty_cache()
        em = emit('cpu')
    em = torch.cat([em, torch.zeros(em.size(0), 1)], dim=1)   # '*' = 아무 소리나 (전주 · 간주 · 애드리브를 흡수)
    # 목표 글자열: * 줄1 * 줄2 * … 줄N *
    targets, owner = [star], [-1]
    for i, r in enumerate(roman):
        ids = [dic[c] for c in r if c in dic]
        if not ids:
            continue
        targets += ids
        owner += [i] * len(ids)
        targets.append(star)
        owner.append(-1)
    if len(targets) > em.size(0):
        raise ValueError('가사가 곡 길이보다 길어요')
    al, sc = F.forced_align(em[None], torch.tensor([targets], dtype=torch.int32), blank=0)
    spans = F.merge_tokens(al[0], sc[0].exp())
    sec = wav.numel() / 16000 / em.size(0)   # 프레임 하나의 길이 (약 0.02초)
    got = {}
    for k, sp in enumerate(spans):
        i = owner[k]
        if i < 0:
            continue
        g = got.setdefault(i, [sp.start, sp.end, 0.0, 0])
        g[1] = sp.end
        g[2] += float(sp.score)
        g[3] += 1
    out = []
    for i in range(len(lines)):
        g = got.get(i)
        out.append([round(g[0] * sec, 2), round(g[1] * sec, 2), round(g[2] / max(1, g[3]), 3)] if g else None)
    return {'lines': out, 'vocals': vocals}


def transcribe(path: str, lang: str) -> list:
    import numpy as np
    from faster_whisper import WhisperModel
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-t', '300', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'],
                       capture_output=True, check=False)
    audio = np.frombuffer(r.stdout, dtype=np.float32)
    if audio.size < 16000:
        return []
    model = WhisperModel('base', device='cpu', compute_type='int8', download_root='/opt/whisper')
    segs, _ = model.transcribe(audio, language=lang if lang in ('ko', 'en', 'ja') else None, beam_size=1,
                               vad_filter=True, condition_on_previous_text=False)
    out = [[round(x.start, 2), round(x.end, 2), x.text.strip()[:80]] for x in segs
           if (x.no_speech_prob or 0) < 0.8 and x.text.strip()]
    return out[:400]


def main() -> None:
    path, lang = sys.argv[1], sys.argv[2]
    t0 = time.time()
    res = {}
    if len(sys.argv) > 3:
        try:
            with open(sys.argv[3], encoding='utf-8') as f:
                lines = json.load(f)
            res = forced_lines(path, [str(x) for x in lines][:300])
        except Exception as e:   # noqa: BLE001 — 실패하면 아래 받아쓰기로
            res = {'fa_error': repr(e)[:200]}
    if 'lines' not in res:
        res['segments'] = transcribe(path, lang)
    res['took'] = round(time.time() - t0, 1)
    print(json.dumps(res, ensure_ascii=False))


if __name__ == '__main__':
    main()
