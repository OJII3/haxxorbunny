import { config } from "../config.ts";

/**
 * テキストを VOICEVOX Engine で音声合成して WAV バッファとして返す。
 * audio_query → synthesis の2ステップ API を使用。
 */
export async function textToSpeech(text: string): Promise<Buffer> {
	const speaker = config.voice.voicevoxSpeaker;

	// Step 1: audio_query でクエリを生成
	const queryRes = await fetch(
		`${config.voice.voicevoxUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`,
		{ method: "POST" },
	);

	if (!queryRes.ok) {
		throw new Error(
			`VOICEVOX audio_query failed: ${queryRes.status} ${queryRes.statusText}`,
		);
	}

	const audioQuery = (await queryRes.json()) as Record<string, unknown>;

	// Step 2: synthesis で音声合成
	const synthRes = await fetch(
		`${config.voice.voicevoxUrl}/synthesis?speaker=${speaker}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(audioQuery),
		},
	);

	if (!synthRes.ok) {
		throw new Error(
			`VOICEVOX synthesis failed: ${synthRes.status} ${synthRes.statusText}`,
		);
	}

	const arrayBuffer = await synthRes.arrayBuffer();
	const wavBuffer = Buffer.from(arrayBuffer);

	console.log(
		`[tts] Synthesized: "${text.slice(0, 30)}" → ${wavBuffer.length} bytes`,
	);
	return wavBuffer;
}
