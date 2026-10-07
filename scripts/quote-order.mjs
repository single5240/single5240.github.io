import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../_includes/quote-order.js"), "utf8");
const loaded = new Function(`${source}\nreturn { gcd, quoteStep, quoteIndex };`)();

export const gcd = loaded.gcd;
export const quoteStep = loaded.quoteStep;
export const quoteIndex = loaded.quoteIndex;
