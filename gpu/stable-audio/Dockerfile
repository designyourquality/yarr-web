# YARR 연주곡 GPU 서버 · RunPod Serverless 용
FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY handler.py .
# 모델은 처음 켜질 때 Hugging Face 에서 받아요 (HF_TOKEN 필요). 네트워크 볼륨을 붙이면 다음부터는 캐시에서 읽어요
ENV HF_HOME=/runpod-volume/hf PYTHONUNBUFFERED=1
CMD ["python", "-u", "handler.py"]
