// Renders scripts/icon.svg to the PNG app icons. Run from frontend/ after
// changing the SVG: node scripts/make-icons.mjs
// Uses sharp, which Next.js already installs for image optimisation.
import sharp from "sharp";

const targets = [
  ["public/icon-192.png", 192],
  ["public/icon-512.png", 512],
  ["app/apple-icon.png", 180], // Next.js adds <link rel="apple-touch-icon"> for this file
];

for (const [file, size] of targets) {
  await sharp("scripts/icon.svg").resize(size, size).png().toFile(file);
  console.log(`wrote ${file} (${size}x${size})`);
}
