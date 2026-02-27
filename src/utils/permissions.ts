import type { PermissionResolvable, TextChannel } from "discord.js";

/**
 * bot が指定チャンネルで必要な権限を全て持っているか確認する
 */
export function hasChannelPerms(
	ch: TextChannel,
	botId: string,
	...requiredPerms: PermissionResolvable[]
): boolean {
	const perms = ch.permissionsFor(botId);
	if (!perms) return false;
	return requiredPerms.every((perm) => perms.has(perm));
}
