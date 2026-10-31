# YARR 연주곡 GPU 서버 · RunPod Serverless 용
# stable-audio-3 가 torch 2.7.1 을 쓰므로 같은 버전의 기본 이미지를 써요 (버전이 다르면 torchvision 오류)
FROM pytorch/pytorch:2.7.1-cuda12.6-cudnn9-runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
 && (pip uninstall -y torchvision || true)
COPY handler.py .
# 모델은 처음 켜질 때 Hugging Face 에서 받아요 (HF_TOKEN 필요). 네트워크 볼륨을 붙이면 다음부터는 캐시에서 읽어요
ENV HF_HOME=/runpod-volume/hf PYTHONUNBUFFERED=1
CMD ["python", "-u", "handler.py"]
