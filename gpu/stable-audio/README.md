# 야르 연주곡 GPU 서버 (Stable Audio 3 Medium · RunPod Serverless)

지금은 연주곡을 fal.ai 에 맡겨요 (1곡 약 $0.048). 사용량이 늘면 이 서버로 바꿔 원가를 낮춰요.
서버 함수(house-music)에 **스위치와 자동 대체**가 이미 들어 있어서, 비밀값만 넣으면 바로 바뀌고 문제가 생기면 fal.ai 로 자동으로 돌아가요.

- 쓴 시간만큼만 돈을 내요 (요청이 없으면 GPU 가 꺼져서 0원)
- 처음 켜질 때(콜드 스타트) 모델을 불러오느라 수십 초 늦을 수 있어요
- 이 서버에는 Supabase 키를 두지 않아요. 음원을 base64 로 돌려주면 서버 함수가 저장소에 올려요

## RunPod 설정

- Serverless → New Endpoint → GitHub 저장소 designyourquality/yarr-web · 브랜치 main · Dockerfile 경로 `gpu/stable-audio/Dockerfile` · 빌드 위치 `gpu/stable-audio`
- GPU 24GB · Min Workers 0 · Max Workers 1~2 · Idle Timeout 5초 · 네트워크 볼륨 20GB
- Environment: `HF_TOKEN` (Secret)

## Supabase 비밀값 (시험이 끝난 뒤)

- `SELF_MUSIC_URL` = `https://api.runpod.ai/v2/<엔드포인트 id>`
- `SELF_MUSIC_KEY` = RunPod API 키
- `MUSIC_PROVIDER` = `self` (지우면 다시 fal.ai)

키는 채팅 · 코드에 붙여 넣지 마세요.
