import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isRealDate(value) {
  const match = datePattern.exec(value || "");
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

function problem(label, message) {
  return `${label}: ${message}`;
}

export function validateEnglish(data, label = "entry") {
  const problems = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return [problem(label, "expected an object")];
  }
  if (!isRealDate(data.date)) problems.push(problem(label, "date must be a real YYYY-MM-DD"));
  if (typeof data.sentence !== "string" || data.sentence.trim() === "") problems.push(problem(label, "missing sentence"));
  if (typeof data.translation !== "string" || data.translation.trim() === "") problems.push(problem(label, "missing translation"));
  if (typeof data.note !== "string") problems.push(problem(label, "note must be a string"));

  const source = data.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    problems.push(problem(label, "missing source"));
  } else {
    for (const field of ["author", "work"]) {
      if (typeof source[field] !== "string" || source[field].trim() === "") problems.push(problem(label, `source.${field} is required`));
    }
    if (typeof source.detail !== "string") problems.push(problem(label, "source.detail must be a string"));
    const yearOk = typeof source.year === "number" && Number.isInteger(source.year) || (typeof source.year === "string" && source.year.trim() !== "");
    if (!yearOk) problems.push(problem(label, "source.year must be an integer or a non-empty string"));
  }

  if (!Array.isArray(data.grammar) || data.grammar.length === 0) problems.push(problem(label, "grammar must be a non-empty array"));
  else data.grammar.forEach((item, index) => {
    if (typeof item !== "string" || item.trim() === "") problems.push(problem(label, `grammar[${index}] must be a non-empty string`));
  });

  if (!Array.isArray(data.vocab) || data.vocab.length === 0) problems.push(problem(label, "vocab must be a non-empty array"));
  else data.vocab.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      problems.push(problem(label, `vocab[${index}] must be an object`));
      return;
    }
    for (const field of ["word", "meaning"]) {
      if (typeof item[field] !== "string" || item[field].trim() === "") problems.push(problem(label, `vocab[${index}].${field} is required`));
    }
    for (const field of ["phonetic", "pos", "collocation", "example"]) {
      if (typeof item[field] !== "string") problems.push(problem(label, `vocab[${index}].${field} must be a string`));
    }
  });

  return problems;
}

function yamlSingle(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function descriptionOf(translation) {
  const text = String(translation).replace(/\s+/g, " ").trim();
  if (text.length <= 90) return text;
  return `${text.slice(0, 89)}…`;
}

export function importEnglishFile(file) {
  const full = resolve(file);
  let data;
  try {
    data = JSON.parse(readFileSync(full, "utf8"));
  } catch (error) {
    throw new Error(`${file}: ${error.message}`);
  }
  const problems = validateEnglish(data, file);
  const filenameDate = basename(full, ".json");
  if (!isRealDate(filenameDate)) problems.push(`${file}: filename must be YYYY-MM-DD.json`);
  else if (data && data.date !== filenameDate) problems.push(`${file}: filename date ${filenameDate} does not match date ${data.date}`);
  if (problems.length) throw new Error(problems.join("\n"));

  const dataDir = join(repoRoot, "_data", "english");
  const docDir = join(repoRoot, "_english");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(docDir, { recursive: true });
  const jsonPath = join(dataDir, `${data.date}.json`);
  const docPath = join(docDir, `${data.date}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`);
  const title = `每日英语 · ${data.date}`;
  const description = descriptionOf(data.translation);
  const doc = `---
layout: english
title: ${yamlSingle(title)}
description: ${yamlSingle(description)}
day: ${yamlSingle(data.date)}
date: ${data.date} 08:07:00 +0800
---
`;
  writeFileSync(docPath, doc);
  return { jsonPath, docPath };
}

function isDirectRun() {
  const entry = process.argv[1] ? resolve(process.argv[1]) : "";
  return entry === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: node scripts/import-english.mjs <YYYY-MM-DD.json> [...]");
    process.exit(1);
  }
  try {
    for (const file of files) {
      const written = importEnglishFile(file);
      console.log(`wrote ${written.jsonPath}`);
      console.log(`wrote ${written.docPath}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
