"""구간 찾기 (2026-11-07): 곡 전체를 받아 적어 노래 줄이 몇 초에 나오는지 JSON 한 줄로 출력해요.
서버 함수가 이 시간으로 1절 · 후렴 · 브릿지 버튼의 정확한 시작/끝을 맞춰요.
ACE-Step 가상환경과 섞이지 않게 이미지 기본 파이썬(/opt/conda)에서 따로 돌려요 (vocal_check.py 와 같은 모델).
  사용: python align.py <음원 경로> <ko|en|ja>  →  {"segments": [[시작초, 끝초, "받아 적은 글"], ...], "took": 초}

가사 줄 맞추기 (2026-11-12 · 🎬 MV 가사 싱크): 받아쓰기(whisper base)는 노래를 거의 못 알아들어서 줄 시간이 엉망이었어요.
가사를 이미 알고 있으니 '받아 적기' 대신 '이 글자가 몇 초에 나오는지'만 찾아요 (강제 정렬 · MMS 300M forced aligner + torchaudio forced_align).
  1) Demucs 로 보컬만 분리 (반주가 섞이면 정확도가 떨어져요 · 실패하면 원곡 그대로)
  2) 가사를 로마자로 바꿔 (한글 자모 → 라틴 · 영어는 그대로 · 일본어 가나) 줄 사이에 '아무 소리' 칸(*)을 끼워 한 번에 맞춰요
  사용: python align.py <음원 경로> <ko|en|ja> <가사 줄 JSON 파일>
        →  {"lines": [[시작초, 끝초, 점수] 또는 null, ...], "vocals": true|false, "took": 초}
           (줄 순서 = 넣은 순서 · 점수 0~1 · 글자가 하나도 없는 줄은 null)
  강제 정렬이 실패하면 예전처럼 받아쓰기 결과(segments)를 돌려줘요.

가수가 건너뛴 줄 (2026-11-13 · engine 2): AI 가수가 가사를 다 부르지 않고 몇 줄을 건너뛰거나 순서를 바꾸면
강제 정렬은 '모든 줄을 순서대로 불렀다'고 보고 맞추기 때문에 그 줄부터 뒤가 줄줄이 밀렸어요 (「오늘도 버텼다」: 1절 8줄 중 6줄만 부르고 바로 후렴).
  3) 보컬을 whisper small 로 낱말 시간까지 받아 적고, 가사 줄과 '건너뛰기를 허용하는' 순서 맞추기(DP)로 짝을 지어요
  4) 짝이 맞은 줄: 강제 정렬 시간이 2.5초 안에서 맞으면 강제 정렬(더 정확) · 아니면 받아쓰기 시간
     받아쓰기가 충분히 알아들었는데(줄 절반 이상 짝) 짝이 없는 줄 = 부르지 않은 줄 → [-1, -1, -1] (서버가 화면에서 빼요)
  출력에 "engine": 2 · "matched": 짝 지은 줄 수 를 더해요.
실제로 부른 순서 (engine 3 · 같은 날): 가수가 후렴을 더 부르거나 절 순서를 바꾸면 가사 순서로 맞추는 것 자체가 틀려요.
  5) 받아 적은 낱말을 처음부터 따라가며 지금 부르는 줄을 찾아 "heard": [[시작, 끝, 줄 번호, 닮은 정도], ...] 로 줘요 (서버가 이걸로 MV 구간을 만들어요)."""
import json
import re
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
    # 정렬 모델: MMS 300M forced aligner (torchaudio MMS_FA 와 같은 MMS 계열 · Hugging Face safetensors · 빌드 때 /opt/mms_fa 에 받아 둬요).
    # torchaudio 의 MMS_FA 는 받는 서버(dl.fbaipublicfiles.com) 인증서가 만료돼 받지 못했어요 (2026-11-12).
    import json as _json
    import os
    from transformers import Wav2Vec2ForCTC
    mdir = os.environ.get('YARR_MMS_FA', '/opt/mms_fa')
    with open(os.path.join(mdir, 'vocab.json'), encoding='utf-8') as f:
        vocab = _json.load(f)
    dic = {c: i for c, i in vocab.items() if len(c) == 1}
    star = len(vocab)

    def emit(dev):
        model = Wav2Vec2ForCTC.from_pretrained(mdir, use_safetensors=True).to(dev).eval()
        # 30초씩 (앞뒤 2초 겹쳐서 가장자리는 버려요) — 한 번에 넣으면 메모리가 곡 길이의 제곱으로 들어요
        sr, win, ctx, hop = 16000, 30, 2, 320
        outs = []
        with torch.inference_mode():
            for s in range(0, wav.numel(), win * sr):
                a, b = max(0, s - ctx * sr), min(wav.numel(), s + (win + ctx) * sr)
                x = wav[a:b]
                x = (x - x.mean()) / torch.sqrt(x.var() + 1e-7)   # do_normalize (Wav2Vec2FeatureExtractor 와 같게)
                e = model(x[None].to(dev)).logits
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
    return {'lines': out, 'vocals': vocals, '_wav': wav}


def _key(s: str) -> str:
    """비교용: 괄호 속 애드리브를 빼고 글자(한글 · 가나 · 한자 · 영숫자)만"""
    s = re.sub(r'\([^)]*\)', '', str(s))
    return re.sub(r'[^0-9A-Za-z\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7a3]', '', s).lower()


def heard_words(audio, lang: str) -> list:
    """보컬(16kHz numpy) → 낱말마다 [시작, 끝, 글자] (whisper small · 없으면 base)"""
    import os
    from faster_whisper import WhisperModel
    name = 'small' if os.path.isdir('/opt/whisper/models--Systran--faster-whisper-small') else 'base'
    model = WhisperModel(name, device='cpu', compute_type='int8', download_root='/opt/whisper')
    segs, _ = model.transcribe(audio, language=lang if lang in ('ko', 'en', 'ja') else None, beam_size=5,
                               word_timestamps=True, condition_on_previous_text=False, vad_filter=False)
    out = []
    for sg in segs:
        for w in (sg.words or []):
            k = _key(w.word)
            if k:
                out.append([float(w.start), float(w.end), k])
    return out[:3000]


def match_lines(lines: list, words: list) -> list:
    """가사 줄(부르는 순서) ↔ 받아 적은 낱말: 줄 · 낱말 건너뛰기를 허용하는 순서 맞추기.
    줄마다 [시작, 끝, 닮은 정도] 또는 None (짝 없음)"""
    from difflib import SequenceMatcher
    L = [_key(x) for x in lines]
    n, m = len(L), len(words)
    if not n or not m:
        return [None] * n
    dp = [[0.0] * (m + 1) for _ in range(n + 1)]
    ch = [[None] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        li = L[i]
        for j in range(m, -1, -1):
            best, c = dp[i + 1][j], 0          # 0: 이 줄은 안 불렀어요
            if j < m and dp[i][j + 1] > best:
                best, c = dp[i][j + 1], 1      # 1: 이 낱말은 애드리브 · 잘못 들은 말
            if li and j < m:
                s = ''
                for k in range(j, min(m, j + 16)):
                    s += words[k][2]
                    if len(s) > len(li) * 1.6 + 2:
                        break
                    if len(s) < len(li) * 0.5:
                        continue
                    r = SequenceMatcher(None, li, s, autojunk=False).ratio()
                    if r >= 0.55:
                        v = r * len(li) + dp[i + 1][k + 1]
                        if v > best:
                            best, c = v, (k + 1, r)
            dp[i][j], ch[i][j] = best, c
    out, i, j = [None] * n, 0, 0
    while i < n and j <= m:
        c = ch[i][j]
        if c == 0 or c is None:
            i += 1
        elif c == 1:
            j += 1
        else:
            k, r = c
            out[i] = [round(words[j][0], 2), round(words[k - 1][1], 2), round(r, 3)]
            i, j = i + 1, k
    return out


def heard_lines(lines: list, words: list) -> list:
    """실제로 부른 순서 (engine 3 · 2026-11-13): 받아 적은 낱말을 처음부터 따라가며 '지금 부르는 가사 줄'을 찾아요.
    가사 순서와 상관없이 후렴을 몇 번 반복하든, 어떤 줄을 건너뛰든 그대로 따라가요.
    → [[시작, 끝, 줄 번호(넣은 순서에서 그 글귀가 처음 나온 번호), 닮은 정도], ...] (시간 순)"""
    from difflib import SequenceMatcher
    uniq, seen = [], set()
    for i, ln in enumerate(lines):
        k = _key(ln)
        if len(k) >= 2 and k not in seen:
            seen.add(k)
            uniq.append((k, i))
    m = len(words)
    if not uniq or not m:
        return []
    best = [0.0] * (m + 1)
    ch = [None] * (m + 1)
    for j in range(m - 1, -1, -1):
        b, c, s = best[j + 1], None, ''
        for k in range(j, min(m, j + 16)):
            s += words[k][2]
            for key, i in uniq:
                # 줄 반쪽만으로 짝을 짓지 않게 (반쪽 두 번이 한 줄보다 점수가 높아지는 걸 막아요): 길이 80% 이상 · 닮음 0.7 이상
                if len(s) > len(key) * 1.5 + 2 or len(s) < len(key) * 0.8:
                    continue
                r = SequenceMatcher(None, key, s, autojunk=False).ratio()
                if r >= 0.7:
                    v = r * len(key) + best[k + 1]
                    if v > b:
                        b, c = v, (k + 1, i, r)
        best[j], ch[j] = b, c
    out, j = [], 0
    while j < m:
        c = ch[j]
        if c is None:
            j += 1
            continue
        k, i, r = c
        out.append([round(words[j][0], 2), round(words[k - 1][1], 2), i, round(r, 3)])
        j = k
    return out


def merge(fa: list, wm: list) -> tuple:
    """강제 정렬 + 받아쓰기 짝 → 최종 줄 시간 · 짝 지은 수. 부르지 않은 줄은 [-1, -1, -1]"""
    n = len(wm)
    hit = sum(1 for x in wm if x)
    sure = n > 0 and hit >= max(2, n * 0.5)   # 받아쓰기를 믿을 만해요
    out = []
    for i in range(n):
        f = fa[i] if i < len(fa) else None
        w = wm[i]
        if w:
            out.append(f if f and f[2] >= 0.35 and abs(f[0] - w[0]) <= 2.5 else [w[0], w[1], round(max(0.5, w[2]), 3)])
        elif f and f[2] >= 0.5:
            out.append(f)
        elif sure:
            out.append([-1, -1, -1])
        else:
            out.append(f)
    # 시간 순서가 거꾸로 가는 줄은 모름으로 (서버가 앞뒤 사이로 나눠요)
    last = -1.0
    for i, x in enumerate(out):
        if x and x[0] >= 0:
            if x[0] < last + 0.3:
                out[i] = None
            else:
                last = x[0]
    return out, hit


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
            lines = [str(x) for x in lines][:300]
            res = forced_lines(path, lines)
            wav = res.pop('_wav', None)
            try:   # 가수가 건너뛴 줄 찾기 (실패하면 강제 정렬 결과만)
                # 받아쓰기는 원곡(반주 포함)으로: 보컬만 뽑은 소리보다 오히려 잘 알아들었어요 (2026-11-13 「오늘도 버텼다」 비교)
                words = heard_words(_mix_16k(path).numpy(), lang)
                wm = match_lines(lines, words)
                res['lines'], res['matched'] = merge(res['lines'], wm)
                res['heard'] = heard_lines(lines, words)[:600]   # engine 3: 실제로 부른 순서
                res['engine'] = 3
            except Exception as e:   # noqa: BLE001
                res['wm_error'] = repr(e)[:200]
        except Exception as e:   # noqa: BLE001 — 실패하면 아래 받아쓰기로
            res = {'fa_error': repr(e)[:200]}
    if 'lines' not in res:
        res['segments'] = transcribe(path, lang)
    res['took'] = round(time.time() - t0, 1)
    print(json.dumps(res, ensure_ascii=False))


if __name__ == '__main__':
    main()
