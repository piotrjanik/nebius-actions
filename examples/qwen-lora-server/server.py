"""Minimal demo inference server: Qwen2.5-0.5B base + LoRA adapters, CPU.

The base model snapshot is baked into the image at /app/base-model and the
fine-tuned adapters at /app/adapters, so startup needs no network access.
Loading happens at import time — uvicorn only starts accepting connections
once the model is ready, which keeps /health honest.
"""

import torch
from fastapi import FastAPI
from peft import PeftModel
from pydantic import BaseModel
from transformers import AutoModelForCausalLM, AutoTokenizer

BASE_MODEL = "/app/base-model"
ADAPTERS = "/app/adapters"

tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
base = AutoModelForCausalLM.from_pretrained(BASE_MODEL, torch_dtype=torch.float32)
model = PeftModel.from_pretrained(base, ADAPTERS)
model.eval()

app = FastAPI()


class GenerateRequest(BaseModel):
    prompt: str
    max_new_tokens: int = 64


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/generate")
def generate(req: GenerateRequest) -> dict:
    inputs = tokenizer(req.prompt, return_tensors="pt")
    with torch.no_grad():
        out = model.generate(
            **inputs,
            max_new_tokens=req.max_new_tokens,
            do_sample=False,
            pad_token_id=tokenizer.eos_token_id,
        )
    prompt_len = inputs["input_ids"].shape[1]
    text = tokenizer.decode(out[0][prompt_len:], skip_special_tokens=True)
    return {"text": text}
