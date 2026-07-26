import esbuild from "esbuild";
import process from "node:process";

const mode = process.argv[2] ?? "production";
const isProduction = mode === "production";

if (!isProduction && mode !== "development") {
  throw new Error(`Unsupported build mode: ${mode}`);
}

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "@codemirror/*",
    "@lezer/*",
    "electron",
    "obsidian"
  ],
  format: "cjs",
  logLevel: "info",
  outfile: "main.js",
  platform: "node",
  sourcemap: isProduction ? false : "inline",
  target: "es2021",
  treeShaking: true
});

if (isProduction) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
