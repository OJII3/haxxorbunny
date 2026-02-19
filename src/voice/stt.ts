import { config } from "../config.ts";
import { pcmToWav } from "./audio-utils.ts";
import { SAMPLE_RATE } from "./constants.ts";

/**
 * PCM バッファを whisper.cpp サーバーに送信してテキストに変換する。
 * whisper.cpp の /inference エンドポイントを使用。
 */
export async function speechToText(
	pcmBuffer: Buffer,
	sampleRate = SAMPLE_RATE,
): Promise<string> {
	const wavBuffer = pcmToWav(pcmBuffer, sampleRate);

	const formData = new FormData();
	formData.append(
		"file",
		new Blob([wavBuffer], { type: "audio/wav" }),
		"audio.wav",
	);
	formData.append("response_format", "json");
	formData.append("language", "ja");

	const response = await fetch(`${config.voice.whisperUrl}/inference`, {
		method: "POST",
		body: formData,
	});

	if (!response.ok) {
		throw new Error(
			`whisper.cpp STT failed: ${response.status} ${response.statusText}`,
		);
	}

	const result = (await response.json()) as { text?: string };
	const text = result.text?.trim() ?? "";

	console.log(`[stt] Transcribed: "${text}"`);
	return text;
}
