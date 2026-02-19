import type { VoiceConnection } from "@discordjs/voice";
import { EndBehaviorType } from "@discordjs/voice";
import OpusScript from "opusscript";
import { config } from "../config.ts";
import { calculateRms } from "./audio-utils.ts";
import {
	MAX_SPEECH_DURATION_MS,
	MIN_SPEECH_DURATION_MS,
	SAMPLE_RATE,
	SILENCE_DURATION_MS,
} from "./constants.ts";

/** 検出された発話セグメント */
export interface SpeechSegment {
	userId: string;
	pcm: Buffer;
	durationMs: number;
}

export type SpeechCallback = (segment: SpeechSegment) => void;

/**
 * ボイスチャンネルの音声受信 + VAD（Voice Activity Detection）を管理する。
 * ユーザーごとの Opus ストリームを監視し、発話区間を検出してコールバックを呼ぶ。
 */
export class VoiceReceiverHandler {
	private readonly connection: VoiceConnection;
	private readonly onSpeech: SpeechCallback;
	private readonly decoder: OpusScript;
	private readonly userBuffers = new Map<
		string,
		{
			chunks: Buffer[];
			lastPacketAt: number;
			speechStartAt: number;
			silenceTimer: ReturnType<typeof setTimeout> | null;
		}
	>();
	private subscribedUsers = new Set<string>();
	private destroyed = false;

	constructor(connection: VoiceConnection, onSpeech: SpeechCallback) {
		this.connection = connection;
		this.onSpeech = onSpeech;
		// 48kHz mono decoder
		this.decoder = new OpusScript(SAMPLE_RATE, 1, OpusScript.Application.VOIP);
	}

	/** 特定ユーザーの音声受信を開始する */
	subscribeUser(userId: string): void {
		if (this.destroyed || this.subscribedUsers.has(userId)) return;
		this.subscribedUsers.add(userId);

		const receiver = this.connection.receiver;
		const opusStream = receiver.subscribe(userId, {
			end: { behavior: EndBehaviorType.Manual },
		});

		opusStream.on("data", (packet: Buffer) => {
			if (this.destroyed) return;
			this.handleOpusPacket(userId, packet);
		});

		opusStream.on("error", (err) => {
			console.warn(`[voice/receiver] Opus stream error for ${userId}:`, err);
		});

		console.log(`[voice/receiver] Subscribed to user ${userId}`);
	}

	/** 特定ユーザーの音声受信を停止する */
	unsubscribeUser(userId: string): void {
		this.subscribedUsers.delete(userId);
		const state = this.userBuffers.get(userId);
		if (state?.silenceTimer) {
			clearTimeout(state.silenceTimer);
		}
		this.userBuffers.delete(userId);
	}

	private handleOpusPacket(userId: string, opusPacket: Buffer): void {
		let pcm: Buffer;
		try {
			pcm = Buffer.from(
				this.decoder.decode(opusPacket),
			);
		} catch {
			return; // デコード失敗は無視
		}

		const rms = calculateRms(pcm);
		const now = Date.now();
		const isSpeaking = rms > config.voice.vadThreshold;

		let state = this.userBuffers.get(userId);

		if (isSpeaking) {
			if (!state) {
				// 新しい発話開始
				state = {
					chunks: [],
					lastPacketAt: now,
					speechStartAt: now,
					silenceTimer: null,
				};
				this.userBuffers.set(userId, state);
			}

			state.chunks.push(pcm);
			state.lastPacketAt = now;

			// 無音タイマーをリセット
			if (state.silenceTimer) {
				clearTimeout(state.silenceTimer);
				state.silenceTimer = null;
			}

			// 最大発話長チェック
			if (now - state.speechStartAt > MAX_SPEECH_DURATION_MS) {
				this.flushSegment(userId);
			}
		} else if (state) {
			// 無音パケット — 無音タイマーを設定
			state.chunks.push(pcm); // 無音部分も含めておく（自然な音声のため）

			if (!state.silenceTimer) {
				state.silenceTimer = setTimeout(() => {
					this.flushSegment(userId);
				}, SILENCE_DURATION_MS);
			}
		}
	}

	/** バッファリングされた音声を SpeechSegment として排出する */
	private flushSegment(userId: string): void {
		const state = this.userBuffers.get(userId);
		if (!state || state.chunks.length === 0) return;

		if (state.silenceTimer) {
			clearTimeout(state.silenceTimer);
		}
		this.userBuffers.delete(userId);

		const pcm = Buffer.concat(state.chunks);
		const durationMs = (pcm.length / 2 / SAMPLE_RATE) * 1000; // 16-bit mono

		if (durationMs < MIN_SPEECH_DURATION_MS) {
			console.log(
				`[voice/receiver] Ignoring short speech from ${userId}: ${Math.round(durationMs)}ms`,
			);
			return;
		}

		console.log(
			`[voice/receiver] Speech segment from ${userId}: ${Math.round(durationMs)}ms, ${pcm.length} bytes`,
		);

		this.onSpeech({ userId, pcm, durationMs });
	}

	/** すべてのリソースを解放する */
	destroy(): void {
		this.destroyed = true;
		for (const [userId, state] of this.userBuffers) {
			if (state.silenceTimer) {
				clearTimeout(state.silenceTimer);
			}
			this.userBuffers.delete(userId);
		}
		this.subscribedUsers.clear();
		this.decoder.delete();
	}
}
