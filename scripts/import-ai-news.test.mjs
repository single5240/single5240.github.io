import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractHtmlSources, mergeSources, prepareNewsHtml } from './import-ai-news.mjs';

test('reimport preserves raw report text and produces one stable navigation/source block', () => {
  const html = '<!doctype html><html lang="zh-CN" data-theme="blueprint" data-mode="auto"><head><title>日报</title></head><body><main class="am-sheet"><h1>日报</h1><p>{{ literal }} {% raw %}</p></main></body></html>';
  const options = { date: '2026-10-17', sources: [{ url: 'https://example.com/article', label: 'Reference' }] };
  const first = prepareNewsHtml(html, options).html;
  const second = prepareNewsHtml(first, options).html;
  assert.equal(first, second);
  assert.equal((second.match(/class="site-header"/g) || []).length, 1);
  assert.equal((second.match(/class="site-footer"/g) || []).length, 1);
  assert.equal((second.match(/class="site-ambience"/g) || []).length, 1);
  assert.equal((second.match(/class="ai-news-subbar"/g) || []).length, 1);
  assert.equal((second.match(/src="\/assets\/js\/theme.js/g) || []).length, 1);
  assert.equal((second.match(/href="\/assets\/css\/ai-news.css/g) || []).length, 1);
  assert.ok(second.includes('{{ literal }} {% raw %}'));
  assert.ok(second.includes('href="https://example.com/article"'));
  assert.ok(second.includes('href="/boards/index.html"'));
  assert.ok(second.includes('content="#e3e6f0"'));
  assert.ok(!second.includes('?v=20261018'));
  assert.ok(!second.startsWith('---'));
});

test('extractHtmlSources preserves existing rendered source links without duplicating arrow', () => {
  const html = '<!-- s5-news-sources:start --><section class="s5-news-sources"><ol><li><a href="https://example.com/?a=1&amp;b=2">Example &amp; Ref ↗</a></li></ol></section><!-- s5-news-sources:end -->';
  assert.deepEqual(extractHtmlSources(html), [{ url: 'https://example.com/?a=1&b=2', label: 'Example & Ref' }]);
});

test('mergeSources preserves existing links and appends only new URLs', () => {
  const merged = mergeSources(
    [{ url: 'https://a.com', label: 'Keep A' }],
    [{ url: 'https://a.com', label: 'Short A' }, { url: 'https://b.com', label: 'New B' }],
  );
  assert.deepEqual(merged, [
    { url: 'https://a.com', label: 'Keep A' },
    { url: 'https://b.com', label: 'New B' },
  ]);
});
