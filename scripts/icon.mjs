import sharp from "sharp";
import { readFileSync } from "node:fs";

const svg = readFileSync("src-tauri/icons/braid.svg");


// 1024 is what `tauri icon` wants as a source; it downsamples everything else.
await sharp(svg, { density: 384 })
  .resize(1024, 1024)
  .png()
  .toFile("src-tauri/icons/source.png");

console.log("Wrote src-tauri/icons/source.png — now run: pnpm tauri icon src-tauri/icons/source.png");
