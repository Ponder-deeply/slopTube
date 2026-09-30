// Hand-editing a card's bait: title, thumbnail text and hook.

import { App, Modal, Setting } from "obsidian";
import type { Bait } from "../bait";
import { undrawable } from "../thumb";

export interface BaitEdit {
	title: string;
	thumbText: string;
	hook?: string;
}

export class BaitEditModal extends Modal {
	constructor(
		app: App,
		private bait: Bait,
		private onSave: (edit: BaitEdit) => Promise<void>,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		const edit: BaitEdit = { title: this.bait.title, thumbText: this.bait.thumbText, hook: this.bait.hook ?? "" };
		this.setTitle("Cím szerkesztése");

		new Setting(contentEl).setName("Cím").addTextArea((t) => {
			t.setValue(edit.title).onChange((v) => (edit.title = v));
			t.inputEl.rows = 2;
			t.inputEl.addClass("st-edit-wide");
		});

		const thumb = new Setting(contentEl).setName("Bélyegkép felirata").setDesc("1–3 szó, a blokkbetűk miatt legfeljebb 12 karakter szavanként.");
		const warn = thumb.descEl.createDiv({ cls: "st-edit-warn" });
		const check = () => {
			const bad = undrawable(edit.thumbText);
			warn.setText(bad ? `Nem rajzolható: ${bad}` : "");
		};
		thumb.addText((t) => t.setValue(edit.thumbText).onChange((v) => ((edit.thumbText = v), check())));
		check();

		new Setting(contentEl).setName("Válasz (hook)").setDesc("A cím kérdésére felelő egy sor; üresen elmarad.").addTextArea((t) => {
			t.setValue(edit.hook ?? "").onChange((v) => (edit.hook = v));
			t.inputEl.rows = 3;
			t.inputEl.addClass("st-edit-wide");
		});

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Mégse").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText("Mentés")
					.setCta()
					.onClick(async () => {
						if (!edit.title.trim()) return;
						await this.onSave({ title: edit.title.trim(), thumbText: edit.thumbText.trim(), hook: edit.hook?.trim() || undefined });
						this.close();
					}),
			);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
