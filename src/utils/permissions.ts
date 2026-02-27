import {
	ChannelType,
	type GuildChannel,
	PermissionFlagsBits,
	type PermissionResolvable,
} from "discord.js";

/**
 * bot が指定チャンネルで必要な権限を全て持っているか確認する。
 * GuildText / GuildAnnouncement / その他の GuildChannel で使用可能。
 */
export function hasChannelPerms(
	ch: GuildChannel,
	botId: string,
	...requiredPerms: PermissionResolvable[]
): boolean {
	const perms = ch.permissionsFor(botId);
	if (!perms) return false;
	return requiredPerms.every((perm) => perms.has(perm));
}

/**
 * bot が対象チャンネルで sendTyping を呼べるか判定する。
 * GuildText / GuildAnnouncement の場合は SendMessages 権限をチェックし、
 * 権限がなければ false を返すことで Missing Access (403) エラーを防ぐ。
 * スレッド等その他の sendTyping 対応チャンネルはそのまま許可する。
 *
 * channel は AgentContext.channel（GuildTextBasedChannel）を想定。
 * guild は AgentContext.guild を想定。
 */
export function canSendTyping(
	channel: { type?: ChannelType; sendTyping?: unknown; id: string },
	botId: string,
	guild: {
		channels: {
			cache: {
				get(
					id: string,
				): { permissionsFor?: GuildChannel["permissionsFor"] } | undefined;
			};
		};
	},
): boolean {
	if (!("sendTyping" in channel)) return false;
	// GuildText / GuildAnnouncement の場合は権限チェック
	if (
		"type" in channel &&
		(channel.type === ChannelType.GuildText ||
			channel.type === ChannelType.GuildAnnouncement)
	) {
		const guildChannel = guild.channels.cache.get(channel.id);
		if (!guildChannel?.permissionsFor) return false;
		const perms = guildChannel.permissionsFor(botId);
		if (!perms) return false;
		return perms.has(PermissionFlagsBits.SendMessages);
	}
	// スレッド等その他の sendTyping 対応チャンネルはそのまま許可
	return true;
}
