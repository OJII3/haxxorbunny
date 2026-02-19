import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Goal {
	id: string;
	title: string;
	description: string;
	status: "active" | "completed" | "abandoned";
	priority: "low" | "medium" | "high";
	created_at: string;
	updated_at: string;
	progress_notes: string[];
}

export interface GoalsData {
	goals: Goal[];
	last_review: string;
}

const GOALS_PATH = join(import.meta.dir, "../../data/goals.json");
const MAX_ACTIVE_GOALS = 5;

export function loadGoals(): GoalsData {
	try {
		const raw = readFileSync(GOALS_PATH, "utf-8");
		return JSON.parse(raw) as GoalsData;
	} catch {
		const defaultData: GoalsData = { goals: [], last_review: "" };
		saveGoals(defaultData);
		return defaultData;
	}
}

export function saveGoals(data: GoalsData): void {
	writeFileSync(GOALS_PATH, JSON.stringify(data, null, "\t"), "utf-8");
}

export function getActiveGoals(): Goal[] {
	const data = loadGoals();
	return data.goals.filter((g) => g.status === "active");
}

export function addGoal(
	title: string,
	description: string,
	priority: "low" | "medium" | "high" = "medium",
): Goal | null {
	const data = loadGoals();
	const activeCount = data.goals.filter((g) => g.status === "active").length;

	if (activeCount >= MAX_ACTIVE_GOALS) {
		return null;
	}

	const now = new Date().toISOString();
	const goal: Goal = {
		id: `goal_${Date.now()}`,
		title,
		description,
		status: "active",
		priority,
		created_at: now,
		updated_at: now,
		progress_notes: [],
	};

	data.goals.push(goal);
	saveGoals(data);
	console.log(`[goals] Added: ${title} (priority=${priority})`);
	return goal;
}

export function updateGoalProgress(goalId: string, note: string): boolean {
	const data = loadGoals();
	const goal = data.goals.find((g) => g.id === goalId && g.status === "active");
	if (!goal) return false;

	goal.progress_notes.push(`[${new Date().toISOString()}] ${note}`);
	goal.updated_at = new Date().toISOString();
	saveGoals(data);
	console.log(`[goals] Progress on ${goal.title}: ${note}`);
	return true;
}

export function completeGoal(goalId: string): boolean {
	const data = loadGoals();
	const goal = data.goals.find((g) => g.id === goalId && g.status === "active");
	if (!goal) return false;

	goal.status = "completed";
	goal.updated_at = new Date().toISOString();
	saveGoals(data);
	console.log(`[goals] Completed: ${goal.title}`);
	return true;
}

export function abandonGoal(goalId: string): boolean {
	const data = loadGoals();
	const goal = data.goals.find((g) => g.id === goalId && g.status === "active");
	if (!goal) return false;

	goal.status = "abandoned";
	goal.updated_at = new Date().toISOString();
	saveGoals(data);
	console.log(`[goals] Abandoned: ${goal.title}`);
	return true;
}

export function goalsToPrompt(): string {
	const active = getActiveGoals();
	if (active.length === 0) return "";

	const priorityOrder = { high: 0, medium: 1, low: 2 };
	const sorted = [...active].sort(
		(a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
	);

	let prompt = "\n## 現在の目標 (GOALS)\n";
	for (const goal of sorted) {
		const priorityMark =
			goal.priority === "high"
				? "🔴"
				: goal.priority === "medium"
					? "🟡"
					: "🟢";
		prompt += `- ${priorityMark} **${goal.title}**: ${goal.description}`;
		if (goal.progress_notes.length > 0) {
			const lastNote = goal.progress_notes[goal.progress_notes.length - 1];
			prompt += ` (最新進捗: ${lastNote})`;
		}
		prompt += "\n";
	}

	return prompt;
}
