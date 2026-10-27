/** The one place UI code turns stable IDs into text: the active pack decides (names, short codes). An ID is never shown. */
import type { Resolver } from "./resolve";

export const driverLabel = (id: string, resolver: Resolver): string => resolver.driver(id).displayName;
export const driverShortLabel = (id: string, resolver: Resolver): string => resolver.driver(id).short;
export const driverSurname = (id: string, resolver: Resolver): string => resolver.driver(id).displayName.split(" ").slice(-1)[0];
export const teamLabel = (id: string, resolver: Resolver): string => resolver.team(id).displayName;

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const mixWhite = (hex: string, t: number): string =>
  "#" + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - t) + 255 * t).toString(16).padStart(2, "0")).join("");

/** The colour that marks the player's cars: the team's primary, or the primary lightened until it shows on the panels (3:1, the bar for
 * graphics) so a purple team still reads as purple, or else the first of its other colours that shows. A livery that is dark all over
 * (a near-black primary cannot be lightened into anything but grey) falls back to the text colour. */
export function markColour(colours: { primary: string; secondary: string; accent: string }, background = "#171c24", fallback = "#e6e9ef"): string {
  const ok = (c: string) => /^#[0-9a-f]{6}$/i.test(c) && contrast(c, background) >= 3;
  if (ok(colours.primary)) return colours.primary;
  if (/^#[0-9a-f]{6}$/i.test(colours.primary) && luminance(colours.primary) >= 0.03) {
    for (let t = 0.1; t <= 0.5; t += 0.1) {
      const c = mixWhite(colours.primary, t);
      if (ok(c)) return c;
    }
  }
  return [colours.secondary, colours.accent].find(ok) ?? fallback;
}
