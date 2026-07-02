# Serves the fine-tuned demo model (Qwen2.5-0.5B base + LoRA adapters) on CPU.
# The base model is snapshot-downloaded at BUILD time so the image is hermetic
# (no Hugging Face egress at runtime). The demo workflow copies the trained
# adapters into ./adapters before `docker build`; PeftModel loads the
# adapter_config.json/adapter_model.safetensors that Axolotl wrote there.
# Deps are intentionally unpinned: the adapters come from a rolling Axolotl
# image, so a current peft/transformers is the compatible choice for a demo.
FROM python:3.11-slim

ENV PIP_NO_CACHE_DIR=1 \
    HF_HUB_DISABLE_PROGRESS_BARS=1

RUN pip install torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install transformers peft fastapi "uvicorn[standard]" huggingface_hub

WORKDIR /app

RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen2.5-0.5B', local_dir='/app/base-model')"

COPY adapters/ /app/adapters/
COPY server.py /app/server.py

EXPOSE 8080
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
