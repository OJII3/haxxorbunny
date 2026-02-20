/** Discord Opus 受信時のサンプルレート */
export const SAMPLE_RATE = 48000;

/** モノラル */
export const CHANNELS = 1;

/** PCM 16-bit のビット深度 */
export const BIT_DEPTH = 16;

/** VAD: 発話終了と判定する無音継続時間 (ms) */
export const SILENCE_DURATION_MS = 600;

/** VAD: 最小発話長 (ms) — これより短い発話は無視 */
export const MIN_SPEECH_DURATION_MS = 300;

/** VAD: 最大発話長 (ms) — これを超えたら強制終了 */
export const MAX_SPEECH_DURATION_MS = 30_000;
