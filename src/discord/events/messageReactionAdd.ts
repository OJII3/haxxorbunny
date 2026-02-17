import type {
	MessageReaction,
	PartialMessageReaction,
	PartialUser,
	User,
} from "discord.js";

export async function handleMessageReactionAdd(
	_reaction: MessageReaction | PartialMessageReaction,
	_user: User | PartialUser,
): Promise<void> {
	// Phase 4 で実装予定
}
