// Plugin settings, their tab, and the view sliders shared with the feed's "⋯" panel.

import { App, Platform, PluginSettingTab, Setting } from "obsidian";
import { defaultClaudePath } from "./claude";
import type SlopTube from "./main";

export interface SlopSettings {
	/** Random-feed weight multiplier for active-semester subjects. */
	activeBoost: number;
	/** Per-subject random-feed weight; 0 removes the subject from the random feed. */
	subjectWeights: Record<string, number>;
	/** Minimum card width (px) in the feed; the grid fits as many columns as it can. */
	cardWidth: number;
	/** Text size of every SlopTube view, in percent; thumbnail art is sized by the thumbnail instead. */
	fontScale: number;
	/** Maximum width (px) of the watch page's content column. */
	watchWidth: number;
	/** Distance (px) from the watch view's bottom edge that reveals the related rail. */
	railThreshold: number;
	/** Number of cards in the related rail. */
	railSize: number;
	/** Claude Code CLI binary that runs the improve-prose skill (desktop only). */
	claudePath: string;
	/** Daily goal in credits per active-semester subject. */
	goalPerSubject: number;
	/** How much more likely a fully overdue note is to surface; 0 turns overdue ranking off. */
	overdueBoost: number;
	/** Hide the hook and the note behind the question until "mutasd" is clicked. */
	/** Show the owl's line under the chips. */
	owl: boolean;
}

export const DEFAULT_SETTINGS: SlopSettings = {
	activeBoost: 3,
	cardWidth: 260,
	fontScale: 100,
	watchWidth: 920,
	subjectWeights: {},
	railThreshold: 80,
	railSize: 10,
	claudePath: defaultClaudePath(),
	goalPerSubject: 3,
	overdueBoost: 4,
	owl: true,
};

/** Card size, font size and watch width: live layout sliders, used by the tab and the feed panel. */
export function addLayoutSettings(containerEl: HTMLElement, plugin: SlopTube): void {
	const s = plugin.settings;
	const slider = (name: string, desc: string, min: number, max: number, step: number, key: "cardWidth" | "fontScale" | "watchWidth") =>
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addSlider((sl) =>
				sl.setLimits(min, max, step).setValue(s[key]).setDynamicTooltip().onChange(async (v) => {
					s[key] = v;
					plugin.applyLayout();
					await plugin.saveSettings();
				}),
			);
	slider("Card size", "Minimum card width in pixels; smaller means more columns.", 160, 520, 20, "cardWidth");
	slider("Font size", "Text size in percent; thumbnail art keeps its size.", 70, 160, 5, "fontScale");
	slider("Watch page width", "Maximum width of the watch page's column in pixels.", 600, 1600, 20, "watchWidth");
}

export class SlopSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: SlopTube) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl, plugin } = this;
		const s = plugin.settings;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Active-semester boost")
			.setDesc("Random-feed weight multiplier for subjects with a course folder in the newest semester.")
			.addSlider((sl) =>
				sl.setLimits(1, 10, 1).setValue(s.activeBoost).setDynamicTooltip().onChange(async (v) => {
					s.activeBoost = v;
					await plugin.saveSettings();
				}),
			);
		addLayoutSettings(containerEl, plugin);
		new Setting(containerEl)
			.setName("Related rail trigger distance")
			.setDesc("How close (px) the mouse must get to the bottom of the watch page to show related notes.")
			.addSlider((sl) =>
				sl.setLimits(20, 200, 10).setValue(s.railThreshold).setDynamicTooltip().onChange(async (v) => {
					s.railThreshold = v;
					await plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName("Related rail size")
			.addSlider((sl) =>
				sl.setLimits(4, 20, 1).setValue(s.railSize).setDynamicTooltip().onChange(async (v) => {
					s.railSize = v;
					await plugin.saveSettings();
				}),
			);

		if (Platform.isDesktopApp) {
			new Setting(containerEl)
				.setName("Claude CLI path")
				.setDesc("Claude Code binary for the watch page's \"Próza javítása\" button; empty means the default.")
				.addText((t) =>
					t.setPlaceholder(defaultClaudePath()).setValue(s.claudePath).onChange(async (v) => {
						s.claudePath = v.trim() || defaultClaudePath();
						await plugin.saveSettings();
					}),
				);
		}

		new Setting(containerEl).setName("Habit loop").setHeading();
		new Setting(containerEl)
			.setName("Daily goal per active subject")
			.setDesc("Credits a day for each active-semester subject; a note earns 1 once all its due gates are graded in a day, 3 if one was golden.")
			.addSlider((sl) =>
				sl.setLimits(1, 20, 1).setValue(s.goalPerSubject).setDynamicTooltip().onChange(async (v) => {
					s.goalPerSubject = v;
					await plugin.saveSettings();
					plugin.refreshHabit();
				}),
			);
		new Setting(containerEl)
			.setName("Overdue boost")
			.setDesc("A fully overdue note is this much more likely to appear in the random feed, plus one; 0 turns it off.")
			.addSlider((sl) =>
				sl.setLimits(0, 10, 1).setValue(s.overdueBoost).setDynamicTooltip().onChange(async (v) => {
					s.overdueBoost = v;
					await plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName("Owl")
			.setDesc("A passive-aggressive line under the feed's chips.")
			.addToggle((t) =>
				t.setValue(s.owl).onChange(async (v) => {
					s.owl = v;
					await plugin.saveSettings();
					plugin.refreshHabit();
				}),
			);

		new Setting(containerEl).setName("Subject weights (random feed)").setHeading();
		for (const ch of plugin.model.channels) {
			new Setting(containerEl)
				.setName(ch.id)
				.setDesc(`${ch.cards.length} notes`)
				.addSlider((sl) =>
					sl.setLimits(0, 5, 0.5).setValue(s.subjectWeights[ch.id] ?? 1).setDynamicTooltip().onChange(async (v) => {
						s.subjectWeights[ch.id] = v;
						await plugin.saveSettings();
					}),
				);
		}
	}
}
