// SimoBee fork: a bee's portrait, drawn locally as an SVG from its name and trading style. Replaces the OpenAI image
// call of the original Setup page: no key, no cost, no network. Deterministic (same name + style = same picture).
import type { StyleId } from "./settings.js";

/** Style colours, matching the dashboard's --bizzy / --breezy / --boozy. */
const PALETTE: Record<StyleId, { main: string; glow: string; deep: string }> = {
  bizzy: { main: "#e0a31a", glow: "#ffd36b", deep: "#6b4300" },
  breezy: { main: "#9085e9", glow: "#c9c2ff", deep: "#352b8a" },
  boozy: { main: "#d55181", glow: "#ff9dc0", deep: "#6e1a3a" },
};

/** A small 32-bit hash so each name gets its own wing angle, stripe count and background hue shift. */
function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function hexagon(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

export function portraitSvg(name: string, style: StyleId): string {
  const p = PALETTE[style];
  const h = hash(`${name}|${style}`);
  const stripes = 2 + (h % 3); // 2-4 body stripes
  const wing = 18 + (h % 22); // wing tilt in degrees
  const initial = esc(([...name.trim()][0] ?? "B").toUpperCase());

  // Honeycomb background.
  const combs: string[] = [];
  const r = 34;
  for (let row = -1; row < 9; row++) {
    for (let col = -1; col < 9; col++) {
      const cx = col * r * Math.sqrt(3) + (row % 2 ? (r * Math.sqrt(3)) / 2 : 0);
      const cy = row * r * 1.5;
      const lit = (hash(`${h}:${row}:${col}`) % 7) === 0;
      combs.push(`<polygon points="${hexagon(cx, cy, r - 3)}" fill="${lit ? p.main : "none"}" fill-opacity="${lit ? 0.16 : 0}" stroke="${p.main}" stroke-opacity="0.18" stroke-width="2"/>`);
    }
  }

  const bodyStripes: string[] = [];
  for (let i = 0; i < stripes; i++) {
    const y = 262 + i * (86 / stripes);
    bodyStripes.push(`<rect x="170" y="${y.toFixed(1)}" width="172" height="${(40 / stripes).toFixed(1)}" fill="#15121c"/>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs>
  <radialGradient id="bg" cx="50%" cy="42%" r="70%"><stop offset="0" stop-color="${p.deep}"/><stop offset="1" stop-color="#0d0b12"/></radialGradient>
  <radialGradient id="body" cx="42%" cy="35%" r="75%"><stop offset="0" stop-color="${p.glow}"/><stop offset="1" stop-color="${p.main}"/></radialGradient>
  <clipPath id="bodyClip"><ellipse cx="256" cy="300" rx="86" ry="100"/></clipPath>
</defs>
<rect width="512" height="512" fill="url(#bg)"/>
<g>${combs.join("")}</g>
<g opacity="0.85">
  <ellipse cx="176" cy="210" rx="78" ry="44" fill="#ffffff" fill-opacity="0.22" stroke="#ffffff" stroke-opacity="0.55" stroke-width="3" transform="rotate(-${wing} 176 210)"/>
  <ellipse cx="336" cy="210" rx="78" ry="44" fill="#ffffff" fill-opacity="0.22" stroke="#ffffff" stroke-opacity="0.55" stroke-width="3" transform="rotate(${wing} 336 210)"/>
</g>
<ellipse cx="256" cy="300" rx="86" ry="100" fill="url(#body)"/>
<g clip-path="url(#bodyClip)">${bodyStripes.join("")}</g>
<circle cx="256" cy="176" r="58" fill="url(#body)"/>
<path d="M232 126 Q214 84 196 78" stroke="#15121c" stroke-width="6" fill="none" stroke-linecap="round"/>
<path d="M280 126 Q298 84 316 78" stroke="#15121c" stroke-width="6" fill="none" stroke-linecap="round"/>
<circle cx="196" cy="78" r="9" fill="${p.glow}"/><circle cx="316" cy="78" r="9" fill="${p.glow}"/>
<circle cx="234" cy="170" r="10" fill="#15121c"/><circle cx="278" cy="170" r="10" fill="#15121c"/>
<circle cx="237" cy="167" r="3" fill="#fff"/><circle cx="281" cy="167" r="3" fill="#fff"/>
<path d="M238 196 Q256 210 274 196" stroke="#15121c" stroke-width="5" fill="none" stroke-linecap="round"/>
<circle cx="398" cy="414" r="54" fill="#0d0b12" stroke="${p.main}" stroke-width="5"/>
<text x="398" y="434" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-size="56" font-weight="800" fill="${p.glow}">${initial}</text>
</svg>
`;
}
