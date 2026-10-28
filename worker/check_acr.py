"""ACRCloud 연결 확인 (GitHub Actions 에서 'Run workflow' 로 직접 돌릴 때만 실행)

조용한 10초짜리 소리를 ACRCloud 에 보내 키가 맞는지 확인해요. 키 값은 화면에 찍지 않아요.
  1001 (일치 없음)   → 연결 정상
  3001 · 3014       → 키가 틀림 (ACR_ACCESS_KEY · ACR_ACCESS_SECRET 다시 확인)
  3003 · 3015       → 사용 한도 초과
"""
import io
import math
import os
import struct
import sys
import wave

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from review import acr_identify, acr_ready  # noqa: E402

MEANING = {
    0: '연결 정상 (테스트 소리가 어떤 곡과 일치함)',
    1001: '연결 정상 (테스트 소리라 일치하는 곡 없음)',
    2004: '연결 정상 (테스트 소리라 지문을 만들 수 없음)',
    3001: '키가 틀려요: ACR_ACCESS_KEY 를 다시 확인해 주세요',
    3003: '사용 한도를 넘었어요 (무료 체험 한도 · 결제 확인)',
    3014: '서명이 틀려요: ACR_ACCESS_SECRET 을 다시 확인해 주세요',
    3015: '요청이 너무 많아요 (잠시 뒤 다시)',
}


def test_tone() -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(b''.join(struct.pack('<h', int(3000 * math.sin(2 * math.pi * 440 * i / 8000))) for i in range(80000)))
    return buf.getvalue()


def main() -> int:
    if not acr_ready():
        print('ACRCloud 키가 없어요 (ACR_HOST · ACR_ACCESS_KEY · ACR_ACCESS_SECRET 중 빠진 것이 있어요)')
        return 1
    print('ACR_HOST:', os.environ['ACR_HOST'])
    res = acr_identify(test_tone())
    st = res.get('status', {})
    code = st.get('code')
    print(f"ACRCloud 응답: {code} {st.get('msg', '')}")
    print('→', MEANING.get(code, '알 수 없는 응답이에요. 위 메시지를 확인해 주세요'))
    return 0 if code in (0, 1001, 2004) else 1


if __name__ == '__main__':
    sys.exit(main())
