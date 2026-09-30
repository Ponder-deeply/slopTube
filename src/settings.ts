// Plugin settings and their tab.

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
};

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
		new Setting(containerEl)
			.setName("Card size")
			.setDesc("Minimum card width in pixels; smaller means more columns.")
			.addSlider((sl) =>
				sl.setLimits(160, 520, 20).setValue(s.cardWidth).setDynamicTooltip().onChange(async (v) => {
					s.cardWidth = v;
					plugin.applyLayout();
					await plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName("Font size")
			.setDesc("Text size in percent; thumbnail art keeps its size.")
			.addSlider((sl) =>
				sl.setLimits(70, 160, 5).setValue(s.fontScale).setDynamicTooltip().onChange(async (v) => {
					s.fontScale = v;
					plugin.applyLayout();
					await plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName("Watch page width")
			.setDesc("Maximum width of the watch page's column in pixels.")
			.addSlider((sl) =>
				sl.setLimits(600, 1600, 20).setValue(s.watchWidth).setDynamicTooltip().onChange(async (v) => {
					s.watchWidth = v;
					plugin.applyLayout();
					await plugin.saveSettings();
				}),
			);
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
