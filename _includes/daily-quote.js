// Daily quote.
// Calendar day: Asia/Shanghai (UTC+8, no daylight-saving time).
// dayNumber = floor((unixSeconds + 28800) / 86400)
// index = dayNumber modulo the number of quotes
// The same Shanghai date always selects the same quote, with no rebuild.
// Preview another day at ?date=YYYY-MM-DD (that calendar date).
(() => {
  const SHANGHAI_OFFSET_SECONDS = 28800;
  const root = document.querySelector("[data-daily-quote]");
  const dataNode = document.getElementById("daily-quote-data");
  if (!root || !dataNode) return;

  let quotes;
  try {
    quotes = JSON.parse(dataNode.textContent);
  } catch (error) {
    return;
  }
  if (!Array.isArray(quotes) || quotes.length === 0) return;

  const dayNumberForNow = (date) => {
    const unixSeconds = Math.floor(date.getTime() / 1000);
    return Math.floor((unixSeconds + SHANGHAI_OFFSET_SECONDS) / 86400);
  };

  const dayNumberForCalendarDate = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utc = Date.UTC(year, month - 1, day);
    const check = new Date(utc);
    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day
    ) {
      return null;
    }
    return Math.floor(utc / 86400000);
  };

  const override = dayNumberForCalendarDate(new URLSearchParams(window.location.search).get("date"));
  const dayNumber = override === null ? dayNumberForNow(new Date()) : override;
  const index = ((dayNumber % quotes.length) + quotes.length) % quotes.length;
  const quote = quotes[index];
  if (!quote || !quote.zh || !quote.en || !quote.author) return;

  const zh = root.querySelector(".daily-quote-zh");
  const en = root.querySelector(".daily-quote-en");
  const author = root.querySelector(".daily-quote-author");
  const source = root.querySelector(".daily-quote-source");
  if (!zh || !en || !author || !source) return;

  if (zh.textContent !== quote.zh) zh.textContent = quote.zh;
  if (en.textContent !== quote.en) en.textContent = quote.en;
  if (author.textContent !== quote.author) author.textContent = quote.author;
  const nextSource = quote.source || "";
  if (source.textContent !== nextSource) source.textContent = nextSource;
  source.hidden = nextSource.length === 0;
  root.dataset.quoteIndex = String(index);
})();
