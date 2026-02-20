import { BIT_DEPTH, CHANNELS, SAMPLE_RATE } from "./constants.ts";

/** PCM 16-bit バッファの RMS 音量を計算する */
export function calculateRms(pcm: Buffer): number {
	const samples = pcm.length / 2; // 16-bit = 2 bytes per sample
	if (samples === 0) return 0;

	let sumOfSquares = 0;
	for (let i = 0; i < pcm.length; i += 2) {
		const sample = pcm.readInt16LE(i);
		sumOfSquares += sample * sample;
	}
	return Math.sqrt(sumOfSquares / samples);
}

/** PCM 16-bit バッファを WAV 形式に変換する */
export function pcmToWav(
	pcm: Buffer,
	sampleRate = SAMPLE_RATE,
	channels = CHANNELS,
	bitDepth = BIT_DEPTH,
): Buffer {
	const byteRate = (sampleRate * channels * bitDepth) / 8;
	const blockAlign = (channels * bitDepth) / 8;
	const dataSize = pcm.length;
	const headerSize = 44;

	const wav = Buffer.alloc(headerSize + dataSize);

	// RIFF header
	wav.write("RIFF", 0);
	wav.writeUInt32LE(36 + dataSize, 4);
	wav.write("WAVE", 8);

	// fmt sub-chunk
	wav.write("fmt ", 12);
	wav.writeUInt32LE(16, 16); // Sub-chunk size
	wav.writeUInt16LE(1, 20); // Audio format (PCM)
	wav.writeUInt16LE(channels, 22);
	wav.writeUInt32LE(sampleRate, 24);
	wav.writeUInt32LE(byteRate, 28);
	wav.writeUInt16LE(blockAlign, 32);
	wav.writeUInt16LE(bitDepth, 34);

	// data sub-chunk
	wav.write("data", 36);
	wav.writeUInt32LE(dataSize, 40);
	pcm.copy(wav, 44);

	return wav;
}
