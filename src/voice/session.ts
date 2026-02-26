import { Readable } from "node:stream";
import {
	type AudioPlayer,
	AudioPlayerStatus,
	createAudioPlayer,
	createAudioResource,
	entersState,
	joinVoiceChannel,
	type VoiceConnection,
	VoiceConnectionStatus,
} from "@discordjs/voice";
import type { Guild, TextBasedChannel, VoiceBasedChannel } from "discord.js";
import { runAgentLoop } from "../agent/loop.ts";
import type { AgentContext, VoiceContext } from "../agent/types.ts";
import { config } from "../config.ts";
import { type SpeechSegment, VoiceReceiverHandler } from "./receiver.ts";
import { speechToText } from "./stt.ts";
import { textToSpeech } from "./tts.ts";

/** ボイスセッションの破棄理由 */
export type DestroyReason =
	| "silence_timeout"
	| "max_session"
	| "all_left"
	| "leave_command"
	| "error";

/** 音声トランスクリプト履歴 */
interface TranscriptEntry {
	userId: string;
	displayName: string;
	text: string;
	timestamp: number;
}

/**
 * VC セッション。1 ギルドにつき 1 セッション。
 * ライフサイクル: start() → 音声受信ループ → destroy(reason)
 */
export class VoiceSession {
	readonly guildId: string;
	readonly voiceChannel: VoiceBasedChannel;
	readonly textChannel: TextBasedChannel;
	readonly guild: Guild;

	private connection: VoiceConnection | null = null;
	private player: AudioPlayer | null = null;
	private receiver: VoiceReceiverHandler | null = null;
	private silenceTimer: ReturnType<typeof setTimeout> | null = null;
	private maxSessionTimer: ReturnType<typeof setTimeout> | null = null;
	private startedAt = 0;
	private destroyed = false;
	private processing = false;
	private transcripts: TranscriptEntry[] = [];

	constructor(
		guild: Guild,
		voiceChannel: VoiceBasedChannel,
		textChannel: TextBasedChannel,
	) {
		this.guildId = guild.id;
		this.guild = guild;
		this.voiceChannel = voiceChannel;
		this.textChannel = textChannel;
	}

	/** VC に参加してセッションを開始する */
	async start(): Promise<void> {
		this.startedAt = Date.now();

		// VC 接続（DAVE E2EE は Bun の NAPI 互換性問題により無効化）
		this.connection = joinVoiceChannel({
			channelId: this.voiceChannel.id,
			guildId: this.guildId,
			adapterCreator: this.guild.voiceAdapterCreator,
			selfDeaf: false, // 受信するために deaf を解除
			daveEncryption: false,
		});

		// Ready 状態を待つ
		try {
			await entersState(this.connection, VoiceConnectionStatus.Ready, 10_000);
		} catch {
			console.error("[voice/session] Failed to connect to voice channel");
			this.destroy("error");
			return;
		}

		// AudioPlayer 作成
		this.player = createAudioPlayer();
		this.connection.subscribe(this.player);

		// 音声受信ハンドラ作成
		this.receiver = new VoiceReceiverHandler(this.connection, (segment) =>
			this.handleSpeech(segment),
		);

		// 現在 VC にいるメンバーの受信を開始
		for (const [memberId, member] of this.voiceChannel.members) {
			if (!member.user.bot) {
				this.receiver.subscribeUser(memberId);
			}
		}

		// タイマー設定
		this.resetSilenceTimer();
		this.maxSessionTimer = setTimeout(() => {
			console.log("[voice/session] Max session time reached");
			this.destroy("max_session");
		}, config.voice.maxSessionMs);

		// 切断イベント監視
		this.connection.on(VoiceConnectionStatus.Disconnected, () => {
			console.log("[voice/session] Disconnected from voice channel");
			this.destroy("error");
		});

		console.log(
			`[voice/session] Started in ${this.voiceChannel.name} (guild: ${this.guildId})`,
		);
	}

	/** 新しいメンバーが VC に参加した場合のリスニング開始 */
	addUser(userId: string): void {
		if (this.destroyed || !this.receiver) return;
		this.receiver.subscribeUser(userId);
	}

	/** メンバーが VC から退出した場合のリスニング停止 */
	removeUser(userId: string): void {
		if (this.destroyed || !this.receiver) return;
		this.receiver.unsubscribeUser(userId);
	}

	/** VC の人間メンバー数を確認して全員退出なら終了 */
	checkEmpty(): void {
		if (this.destroyed) return;
		const humanMembers = this.voiceChannel.members.filter((m) => !m.user.bot);
		if (humanMembers.size === 0) {
			console.log("[voice/session] All humans left the voice channel");
			this.destroy("all_left");
		}
	}

	/** テキストを TTS で再生する */
	async speak(text: string): Promise<void> {
		if (this.destroyed || !this.player || !this.connection) return;

		try {
			const wavBuffer = await textToSpeech(text);
			const readable = Readable.from(wavBuffer);
			const resource = createAudioResource(readable);

			this.player.play(resource);
			await entersState(this.player, AudioPlayerStatus.Idle, 30_000);
		} catch (error) {
			console.error("[voice/session] TTS playback failed:", error);
		}
	}

	/** セッションが破棄済みかどうか */
	get isDestroyed(): boolean {
		return this.destroyed;
	}

	/** 直近のトランスクリプトを取得 */
	getRecentTranscripts(limit = 10): TranscriptEntry[] {
		return this.transcripts.slice(-limit);
	}

	/** VoiceContext を構築する */
	buildVoiceContext(): VoiceContext {
		const participants = this.voiceChannel.members
			.filter((m) => !m.user.bot)
			.map((m) => m.displayName);

		return {
			voiceChannelName: this.voiceChannel.name,
			participants,
			recentTranscripts: this.getRecentTranscripts().map((t) => ({
				displayName: t.displayName,
				text: t.text,
				timestamp: t.timestamp,
			})),
		};
	}

	/** セッションを破棄する */
	destroy(reason: DestroyReason): void {
		if (this.destroyed) return;
		this.destroyed = true;

		console.log(
			`[voice/session] Destroying session (reason: ${reason}, duration: ${Math.round((Date.now() - this.startedAt) / 1000)}s)`,
		);

		if (this.silenceTimer) clearTimeout(this.silenceTimer);
		if (this.maxSessionTimer) clearTimeout(this.maxSessionTimer);
		this.receiver?.destroy();
		this.player?.stop(true);
		this.connection?.destroy();

		this.connection = null;
		this.player = null;
		this.receiver = null;
	}

	private resetSilenceTimer(): void {
		if (this.silenceTimer) clearTimeout(this.silenceTimer);
		this.silenceTimer = setTimeout(() => {
			console.log("[voice/session] Silence timeout reached");
			this.destroy("silence_timeout");
		}, config.voice.silenceTimeoutMs);
	}

	private async handleSpeech(segment: SpeechSegment): Promise<void> {
		if (this.destroyed || this.processing) return;
		this.processing = true;
		this.resetSilenceTimer();

		try {
			// STT
			const text = await speechToText(segment.pcm);
			if (!text || text.trim().length === 0) {
				return;
			}

			// トランスクリプト履歴に追加
			const member = this.voiceChannel.members.get(segment.userId);
			const displayName = member?.displayName ?? segment.userId;
			this.transcripts.push({
				userId: segment.userId,
				displayName,
				text,
				timestamp: Date.now(),
			});

			// 古いトランスクリプトを削除（最大20件）
			if (this.transcripts.length > 20) {
				this.transcripts = this.transcripts.slice(-20);
			}

			console.log(`[voice/session] ${displayName}: "${text}"`);

			// エージェントループを voice モードで起動
			const agentCtx: AgentContext = {
				channel: this.textChannel,
				guild: this.guild,
				triggeredBy: "voice",
				isMentioned: true, // voice は常に直接対話
				voiceContext: this.buildVoiceContext(),
			};

			await runAgentLoop(agentCtx);
		} catch (error) {
			console.error("[voice/session] Speech processing error:", error);
		} finally {
			this.processing = false;
		}
	}
}
