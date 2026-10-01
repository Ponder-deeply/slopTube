// The owl: one passive-aggressive line under the feed's chips. In-feed only, never a notification.

import type { Streak } from "./memory";

export interface OwlContext {
	streak: Streak;
	/** Local hour, 0–23. */
	hour: number;
	/** Title of the note that has been overdue longest, if longer than a week. */
	longOverdue: string | null;
	/** An active subject whose kept % fell more than 10 points in a week. */
	fading: string | null;
}

const STREAK_RISK_HOUR = 20;

/** First matching trigger wins; null when the owl has nothing to say. */
export function owlLine(c: OwlContext): string | null {
	const { streak } = c;
	const met = streak.today >= streak.goal;
	if (c.longOverdue) return `${article(c.longOverdue, true)} ${c.longOverdue} hiányol téged.`;
	if (!met && c.hour >= STREAK_RISK_HOUR && streak.current > 0) return `Még ${streak.goal - streak.today} kell. A lángocska fázik.`;
	if (c.fading) return `${article(c.fading, true)} ${c.fading} csatorna csendben elhalványul.`;
	if (streak.lost > 1 && streak.current === 0) return `${streak.lost} napos sorozat. Volt.`;
	if (met) return "Rendben. Holnap is látlak.";
	return null;
}

/** Hungarian definite article: "az" before a vowel sound, else "a". */
export function article(word: string, capital = false): string {
	const az = /^[aáeéiíoóöőuúüű]/i.test(word.trim());
	return (capital ? "A" : "a") + (az ? "z" : "");
}
