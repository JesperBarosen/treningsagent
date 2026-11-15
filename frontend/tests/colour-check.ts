// Colour distances for palette checks in tests: OKLab ΔE ×100, for normal
// vision and under simulated colour-vision deficiency (Machado, Oliveira and
// Fernandes 2009, severity 1.0, applied in linear RGB). The same method as the
// palette validator used in docs/design-visual.md; targets there are ΔE >= 15
// for normal vision and >= 8 under CVD.

type RGB = [number, number, number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function linear(hex: string): RGB {
  return [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255)) as RGB;
}

const MACHADO: Record<"protan" | "deutan" | "tritan", number[][]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const clamp = (x: number) => Math.min(1, Math.max(0, x));

function simulate(rgb: RGB, kind: keyof typeof MACHADO): RGB {
  return MACHADO[kind].map((row) => clamp(row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2])) as RGB;
}

function oklab([r, g, b]: RGB): RGB {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab distance ×100 between two colours, as seen normally or with a CVD. */
export function deltaE(a: string, b: string, vision: "normal" | keyof typeof MACHADO = "normal"): number {
  const see = (hex: string) => oklab(vision === "normal" ? linear(hex) : simulate(linear(hex), vision));
  const [x, y] = [see(a), see(b)];
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** The smallest distance over protanopia, deuteranopia and tritanopia. */
export function worstCvd(a: string, b: string): number {
  return Math.min(deltaE(a, b, "protan"), deltaE(a, b, "deutan"), deltaE(a, b, "tritan"));
}
