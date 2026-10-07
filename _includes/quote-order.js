// Shared by the home page (included before daily-quote.js) and scripts/quote-order.mjs.
// step = smallest integer >= floor(count / 3) + 1 that is coprime to count.
// index = (dayNumber mod count) * step mod count.
// One cycle of `count` days visits every quote once. Adjacent days are `step` apart in the file.

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return x;
}

function quoteStep(count) {
  const total = count | 0;
  if (total <= 1) return 1;
  const start = Math.floor(total / 3) + 1;
  for (let candidate = start; candidate < total; candidate += 1) {
    if (gcd(total, candidate) === 1) return candidate;
  }
  return 1;
}

function quoteIndex(dayNumber, count) {
  const total = count | 0;
  if (total <= 0) return 0;
  const mod = ((dayNumber % total) + total) % total;
  return (mod * quoteStep(total)) % total;
}
