import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { guildDataDir } from "../data/paths.ts";

/** カテゴリの振る舞い定義 */
export interface CategoryBehavior {
	/** トリアージの mood オフセット (-1.0 ~ +1.0) */
	avg_offset: number;
	/** リアクション許可 */
	allow_react: boolean;
	/** 自発的発言（cron/独り言）許可 */
	allow_unsolicited: boolean;
	/** 他botメッセージに反応するか */
	respond_to_bots: boolean;
	/** トリアージへの追加指示 */
	custom_instructions: string;
}

/** カテゴリ定義 */
export interface ChannelCategory {
	id: string;
	name: string;
	description: string;
	builtin: boolean;
	behavior: CategoryBehavior;
	channel_ids: string[];
}

/** ギルドごとの保存形式 */
export interface ChannelCategoriesData {
	categories: ChannelCategory[];
	last_updated: string;
}

/** プリセットカテゴリの振る舞いテンプレート */
const PRESET_CATEGORIES: Omit<ChannelCategory, "channel_ids">[] = [
	{
		id: "my-space",
		name: "自分の居場所",
		description: "独り言や雑談を自由にできる場所。自発的な発言も歓迎",
		builtin: true,
		behavior: {
			avg_offset: 0.5,
			allow_react: true,
			allow_unsolicited: true,
			respond_to_bots: false,
			custom_instructions: "独り言や雑談を自由に。自発的な発言も歓迎",
		},
	},
	{
		id: "observe-only",
		name: "観察のみ",
		description: "基本的に発言しない。リアクションのみ",
		builtin: true,
		behavior: {
			avg_offset: -0.8,
			allow_react: true,
			allow_unsolicited: false,
			respond_to_bots: false,
			custom_instructions: "基本的に発言しない。リアクションのみ",
		},
	},
	{
		id: "bot-chat",
		name: "bot会話",
		description:
			"bot同士の自然な会話。他のbotのメッセージにも人間と同じように反応する",
		builtin: true,
		behavior: {
			avg_offset: 0.3,
			allow_react: true,
			allow_unsolicited: false,
			respond_to_bots: true,
			custom_instructions: "bot同士の自然な会話。人間のように振る舞う",
		},
	},
];

/** 未分類チャンネルのデフォルト動作（メンション時のみ反応） */
export const UNCATEGORIZED_BEHAVIOR: CategoryBehavior = {
	avg_offset: -0.5,
	allow_react: false,
	allow_unsolicited: false,
	respond_to_bots: false,
	custom_instructions: "",
};

function channelCategoriesPath(guildId: string): string {
	return join(guildDataDir(guildId), "channel-categories.json");
}

function homeChannelsPath(guildId: string): string {
	return join(guildDataDir(guildId), "home-channels.json");
}

function channelPoliciesPath(guildId: string): string {
	return join(guildDataDir(guildId), "channel-policies.json");
}

/**
 * 旧データ（home-channels.json + channel-policies.json）からの自動移行。
 * channel-categories.json が存在せず旧ファイルがある場合に実行される。
 */
function migrateFromLegacy(guildId: string): ChannelCategoriesData | null {
	const hcPath = homeChannelsPath(guildId);
	const cpPath = channelPoliciesPath(guildId);

	const hcExists = existsSync(hcPath);
	const cpExists = existsSync(cpPath);

	if (!hcExists && !cpExists) return null;

	console.log(`[channel-category] Migrating legacy data for guild ${guildId}`);

	// プリセットカテゴリを初期化
	const categories: ChannelCategory[] = PRESET_CATEGORIES.map((p) => ({
		...p,
		channel_ids: [],
	}));

	// home-channels.json → my-space に割り当て
	if (hcExists) {
		try {
			const hcData = JSON.parse(readFileSync(hcPath, "utf-8")) as {
				channel_ids: string[];
			};
			const mySpace = categories.find((c) => c.id === "my-space");
			if (mySpace && hcData.channel_ids) {
				mySpace.channel_ids = [...hcData.channel_ids];
				console.log(
					`[channel-category] Migrated ${hcData.channel_ids.length} home channels to my-space`,
				);
			}
		} catch (e) {
			console.warn("[channel-category] Failed to read home-channels.json:", e);
		}
		unlinkSync(hcPath);
		console.log("[channel-category] Deleted legacy home-channels.json");
	}

	// channel-policies.json → カスタムカテゴリとして移行
	if (cpExists) {
		try {
			const cpData = JSON.parse(readFileSync(cpPath, "utf-8")) as {
				policies: Array<{
					channel_id: string;
					original_description: string;
					avg_offset: number;
					allow_react: boolean;
					custom_instructions: string;
				}>;
			};
			for (const policy of cpData.policies ?? []) {
				// 既にどこかのカテゴリに含まれているかチェック
				const alreadyAssigned = categories.some((c) =>
					c.channel_ids.includes(policy.channel_id),
				);
				if (alreadyAssigned) continue;

				// ポリシーの内容に基づいてカスタムカテゴリを作成
				const customId = `migrated-${policy.channel_id.slice(-6)}`;
				categories.push({
					id: customId,
					name: `移行済みポリシー (${policy.channel_id.slice(-6)})`,
					description: policy.original_description,
					builtin: false,
					behavior: {
						avg_offset: policy.avg_offset,
						allow_react: policy.allow_react,
						allow_unsolicited: false,
						respond_to_bots: false,
						custom_instructions: policy.custom_instructions,
					},
					channel_ids: [policy.channel_id],
				});
			}
			console.log(
				`[channel-category] Migrated ${cpData.policies?.length ?? 0} channel policies`,
			);
		} catch (e) {
			console.warn(
				"[channel-category] Failed to read channel-policies.json:",
				e,
			);
		}
		unlinkSync(cpPath);
		console.log("[channel-category] Deleted legacy channel-policies.json");
	}

	const data: ChannelCategoriesData = {
		categories,
		last_updated: new Date().toISOString(),
	};

	return data;
}

export function loadCategories(guildId: string): ChannelCategoriesData {
	const path = channelCategoriesPath(guildId);

	if (!existsSync(path)) {
		// 旧データからの移行を試みる
		const migrated = migrateFromLegacy(guildId);
		if (migrated) {
			saveCategories(guildId, migrated);
			return migrated;
		}

		// 初期データ: プリセットカテゴリのみ（チャンネル未割り当て）
		const initial: ChannelCategoriesData = {
			categories: PRESET_CATEGORIES.map((p) => ({
				...p,
				channel_ids: [],
			})),
			last_updated: "",
		};
		return initial;
	}

	try {
		const data = JSON.parse(
			readFileSync(path, "utf-8"),
		) as ChannelCategoriesData;

		// プリセットカテゴリが存在しない場合は追加（アップデート互換）
		for (const preset of PRESET_CATEGORIES) {
			if (!data.categories.find((c) => c.id === preset.id)) {
				data.categories.push({ ...preset, channel_ids: [] });
			}
		}

		return data;
	} catch {
		console.warn("[channel-category] Failed to parse, returning default");
		return {
			categories: PRESET_CATEGORIES.map((p) => ({
				...p,
				channel_ids: [],
			})),
			last_updated: "",
		};
	}
}

export function saveCategories(
	guildId: string,
	data: ChannelCategoriesData,
): void {
	const path = channelCategoriesPath(guildId);
	data.last_updated = new Date().toISOString();
	writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

/** 指定チャンネルが属するカテゴリを取得。未分類なら null */
export function getCategoryForChannel(
	guildId: string,
	channelId: string,
): ChannelCategory | null {
	const data = loadCategories(guildId);
	return data.categories.find((c) => c.channel_ids.includes(channelId)) ?? null;
}

/** 指定チャンネルの振る舞いを取得。未分類なら UNCATEGORIZED_BEHAVIOR */
export function getChannelBehavior(
	guildId: string,
	channelId: string,
): CategoryBehavior {
	const category = getCategoryForChannel(guildId, channelId);
	return category?.behavior ?? UNCATEGORIZED_BEHAVIOR;
}

/** チャンネルがいずれかのカテゴリに分類されているか */
export function isChannelCategorized(
	guildId: string,
	channelId: string,
): boolean {
	return getCategoryForChannel(guildId, channelId) !== null;
}

/** チャンネルが bot-chat カテゴリ（respond_to_bots=true）か */
export function shouldRespondToBots(
	guildId: string,
	channelId: string,
): boolean {
	const behavior = getChannelBehavior(guildId, channelId);
	return behavior.respond_to_bots;
}

/** プリセットカテゴリの振る舞いテンプレートを取得 */
export function getPresetBehavior(categoryId: string): CategoryBehavior | null {
	const preset = PRESET_CATEGORIES.find((p) => p.id === categoryId);
	return preset?.behavior ?? null;
}
