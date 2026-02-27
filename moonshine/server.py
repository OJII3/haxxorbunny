"""
Moonshine ASR FastAPI server.
whisper.cpp /inference API compatible endpoint for STT.
Uses UsefulSensors/moonshine-tiny-ja (27M params, CER 18.3).
"""

import io
import logging

import librosa
import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse
from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("moonshine")

MODEL_ID = "UsefulSensors/moonshine-tiny-ja"
TARGET_SR = 16000

app = FastAPI(title="Moonshine ASR Server")

# Global model / processor (loaded on startup)
model = None
processor = None


@app.on_event("startup")
async def load_model():
    global model, processor
    logger.info(f"Loading model: {MODEL_ID}")
    processor = AutoProcessor.from_pretrained(MODEL_ID)
    model = AutoModelForSpeechSeq2Seq.from_pretrained(
        MODEL_ID,
        torch_dtype=torch.float32,
    )
    model.eval()
    logger.info("Model loaded successfully")


@app.get("/health")
async def health():
    return {"status": "ok", "model": MODEL_ID}


@app.post("/inference")
async def inference(
    file: UploadFile = File(...),
    response_format: str = Form("json"),
    language: str = Form("ja"),
):
    """whisper.cpp /inference compatible endpoint."""
    try:
        audio_bytes = await file.read()
        audio_buf = io.BytesIO(audio_bytes)

        # Load and resample to 16kHz mono
        audio, sr = librosa.load(audio_buf, sr=TARGET_SR, mono=True)

        if len(audio) == 0:
            return JSONResponse(content={"text": ""})

        # Prepare inputs
        inputs = processor(
            audio,
            sampling_rate=TARGET_SR,
            return_tensors="pt",
        )

        with torch.no_grad():
            generated_ids = model.generate(
                inputs["input_features"],
                max_new_tokens=256,
                language=language,
            )

        text = processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
        text = text.strip()

        logger.info(f"Transcribed: \"{text}\"")
        return JSONResponse(content={"text": text})

    except Exception as e:
        logger.error(f"Inference error: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": str(e)},
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8090)
