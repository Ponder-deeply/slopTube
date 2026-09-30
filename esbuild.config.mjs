// Bundles src/main.ts into main.js and copies the plugin into the vault.
// Vault location: $VAULT, defaulting to ~/Documents/Brain.
import esbuild from "esbuild";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const production = process.argv[2] === "production";
const vault = process.env.VAULT ?? join(homedir(), "Documents/Brain");
const PLUGIN_FILES = ["main.js", "manifest.json", "styles.css"];

// Copies only the build output, so bait.json and data.json in the plugin folder survive.
const installIntoVault = {
  name: "install-into-vault",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length) return;
      if (!existsSync(join(vault, ".obsidian"))) {
        console.warn(`[sloptube] no vault at ${vault}; set VAULT to install`);
        return;
      }
      const dest = join(vault, ".obsidian/plugins/sloptube");
      mkdirSync(dest, { recursive: true });
      for (const f of PLUGIN_FILES) copyFileSync(f, join(dest, f));
      console.log(`[sloptube] installed into ${dest}`);
    });
  },
};

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  plugins: [installIntoVault],
});

if (production) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.watch();
}
