import type { VoiceState } from "discord.js";
import { client } from "../../client.ts";
import { voiceManager } from "../../voice/manager.ts";

export function handleVoiceStateUpdate(
	oldState: VoiceState,
	newState: VoiceState,
): void {
	const guildId = newState.guild.id;
	const session = voiceManager.getSession(guildId);
	if (!session) return;

	const userId = newState.id;
	const botId = client.user?.id;

	// bot 自身の状態変更は無視
	if (userId === botId) return;

	const leftChannel = oldState.channelId && !newState.channelId;
	const joinedChannel = !oldState.channelId && newState.channelId;
	const switchedChannel =
		oldState.channelId &&
		newState.channelId &&
		oldState.channelId !== newState.channelId;

	// セッション中のVCに参加した場合
	if (
		(joinedChannel || switchedChannel) &&
		newState.channelId === session.voiceChannel.id
	) {
		if (!newState.member?.user.bot) {
			session.addUser(userId);
			console.log(`[voice/event] User ${userId} joined voice session`);
		}
	}

	// セッション中のVCから退出した場合
	if (
		(leftChannel || switchedChannel) &&
		oldState.channelId === session.voiceChannel.id
	) {
		if (!oldState.member?.user.bot) {
			session.removeUser(userId);
			console.log(`[voice/event] User ${userId} left voice session`);
			// 全員退出チェック
			session.checkEmpty();
		}
	}
}
