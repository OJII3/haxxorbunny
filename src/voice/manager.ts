import type { Guild, TextBasedChannel, VoiceBasedChannel } from "discord.js";
import { VoiceSession } from "./session.ts";

/**
 * ギルドごとに 1 つの VoiceSession を管理する。
 */
class VoiceSessionManager {
	private sessions = new Map<string, VoiceSession>();

	/** セッションを開始する（既にあれば何もしない） */
	async startSession(
		guild: Guild,
		voiceChannel: VoiceBasedChannel,
		textChannel: TextBasedChannel,
	): Promise<VoiceSession> {
		const existing = this.sessions.get(guild.id);
		if (existing && !existing.isDestroyed) {
			console.log(
				`[voice/manager] Session already active for guild ${guild.id}`,
			);
			return existing;
		}

		const session = new VoiceSession(guild, voiceChannel, textChannel);
		this.sessions.set(guild.id, session);

		// セッション破棄時に自動クリーンアップ
		const checkDestroyed = setInterval(() => {
			if (session.isDestroyed) {
				clearInterval(checkDestroyed);
				if (this.sessions.get(guild.id) === session) {
					this.sessions.delete(guild.id);
					console.log(
						`[voice/manager] Cleaned up session for guild ${guild.id}`,
					);
				}
			}
		}, 1000);

		await session.start();
		return session;
	}

	/** ギルドのアクティブなセッションを取得する */
	getSession(guildId: string): VoiceSession | undefined {
		const session = this.sessions.get(guildId);
		if (session?.isDestroyed) {
			this.sessions.delete(guildId);
			return undefined;
		}
		return session;
	}

	/** セッションを終了する */
	endSession(guildId: string, reason: "leave_command" | "all_left"): void {
		const session = this.sessions.get(guildId);
		if (session) {
			session.destroy(reason);
			this.sessions.delete(guildId);
		}
	}

	/** アクティブなセッションがあるか */
	hasActiveSession(guildId: string): boolean {
		return this.getSession(guildId) !== undefined;
	}
}

export const voiceManager = new VoiceSessionManager();
