// A yes/no question before a bulk change.

import { App, Modal, Setting } from "obsidian";

export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private heading: string,
		private message: string,
		private onConfirm: () => Promise<void>,
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle(this.heading);
		this.contentEl.createEl("p", { text: this.message });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Mégse").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText("Jelölés")
					.setCta()
					.onClick(() => {
						this.close();
						void this.onConfirm();
					}),
			);
	}
}

/** Asks for one line of text, prefilled. */
export class NameModal extends Modal {
	constructor(
		app: App,
		private heading: string,
		private initial: string,
		private onSubmit: (value: string) => Promise<void>,
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle(this.heading);
		let value = this.initial;
		const submit = () => {
			this.close();
			void this.onSubmit(value);
		};
		new Setting(this.contentEl).setName("Név").addText((t) => {
			t.setValue(value).onChange((v) => (value = v));
			t.inputEl.addClass("st-edit-wide");
			t.inputEl.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter" && !evt.isComposing) submit();
			});
			window.setTimeout(() => t.inputEl.select(), 0);
		});
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Mégse").onClick(() => this.close()))
			.addButton((b) => b.setButtonText("Létrehozás").setCta().onClick(submit));
	}
}
