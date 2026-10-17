import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareNewsHtml } from './import-ai-news.mjs';

test('reimport preserves raw report text and produces one stable navigation/source block', () => {
  const html = '<!doctype html><html lang="zh-CN" data-theme="blueprint" data-mode="auto"><head><title>日报</title></head><body><main><h1>日报</h1><p>{{ literal }} {% raw %}</p></main></body></html>';
  const options = { date: '2026-10-17', sources: [{ url: 'https://example.com/article', label: 'Reference' }] };
  const first = prepareNewsHtml(html, options).html;
  const second = prepareNewsHtml(first, options).html;
  assert.equal(first, second);
  assert.equal((second.match(/class="s5-news-bar"/g) || []).length, 1);
  assert.equal((second.match(/src="\/assets\/js\/news-theme.js/g) || []).length, 1);
  assert.ok(second.includes('{{ literal }} {% raw %}'));
  assert.ok(second.includes('href="https://example.com/article"'));
  assert.ok(!second.startsWith('---'));
});
