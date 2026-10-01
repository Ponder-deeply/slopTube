// SlopTube entries in Obsidian's empty "New tab" view, next to "Create new file" and "Go to file".
// The view is internal: its action list is `actionListEl`, cleared and refilled on every open,
// so entries are (re)added after each layout change, never twice.

import type { WorkspaceLeaf } from "obsidian";
import type SlopTube from "./main";

const MARK = "st-newtab-action";

type EmptyView = { actionListEl?: HTMLElement };

export function decorateNewTabs(plugin: SlopTube): void {
	for (const leaf of plugin.app.workspace.getLeavesOfType("empty")) {
		const list = (leaf.view as unknown as EmptyView).actionListEl;
		if (!list || list.querySelector(`.${MARK}`)) continue;
		const add = (text: string, run: (leaf: WorkspaceLeaf) => void) => {
			const el = list.createDiv({ cls: `empty-state-action ${MARK}`, text });
			el.onclick = () => run(leaf);
		};
		add("SlopTube megnyitása", (l) => void plugin.openFeed(l));
		add("Véletlen videó", (l) => plugin.randomVideo(l));
	}
}

/** Removes the entries again (on plugin unload). */
export function undecorateNewTabs(): void {
	document.querySelectorAll(`.${MARK}`).forEach((el) => el.remove());
}
