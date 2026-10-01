/* Temporary passwords shown once to an admin. Generated with crypto.randomInt only —
   never Math.random, never stored, never logged, never written to admin_audit. */
import crypto from "node:crypto";

/* Readable alphabet: no 0/O, 1/l/I — these are read aloud and typed by hand. */
export const LOWER = "abcdefghjkmnpqrstuvwxyz";   // no i, l, o
export const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";   // no I, L, O
export const DIGITS = "23456789";                 // no 0, 1
export const SYMBOLS = "!@#$%^&*?";               // easy to type on a phone keyboard
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

const pick = (set) => set[crypto.randomInt(set.length)];

export function generatePassword(length = 14) {
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) {         // shuffle so the classes are not always first
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
