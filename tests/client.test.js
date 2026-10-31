/**
 * Tests for the browser-side modules (no DOM needed).
 * The scripts are plain globals, so they are concatenated into one vm script.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js');
const files = ['tokenizer', 'textProcessor', 'summarizer', 'keyPoints', 'statistics', 'preservation', 'transcript'];
const source = files.map(f => fs.readFileSync(path.join(root, f + '.js'), 'utf8')).join('\n');
const { Tokenizer, TextProcessor, Summarizer, KeyPoints, Statistics, Preservation, Transcript } = vm.runInNewContext(
  source + '\n;({ Tokenizer, TextProcessor, Summarizer, KeyPoints, Statistics, Preservation, Transcript })'
);

const ARTICLE = [
  'Context windows limit how much text a language model can read at once.',
  'Every token counts toward that limit, so long documents must be shortened.',
  'Extractive methods select the most important existing sentences.',
  'Abstractive methods rewrite the content in new words using a model.',
  'Rewriting can compress further, but it risks inventing facts.',
  'Measuring what survives compression is essential for trustworthy summaries.',
  'Question answering tests are one practical way to measure lost meaning.',
].join(' ');

// ─── Transcript parsing ─────────────────────────────────────────────────

test('parseSubtitles reads VTT cues, strips tags and sound cues', () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<v Asha>Hello team.\n\n00:00:05.000 --> 00:00:08.000\n[Music]\nWe ship Friday.\n';
  const segs = Transcript.parseSubtitles(vtt);
  assert.equal(segs.length, 2);
  assert.deepEqual({ ...segs[0] }, { start: 1, text: 'Hello team.' });
  assert.equal(segs[1].text, 'We ship Friday.');
});

test('parseSubtitles reads SRT with comma milliseconds and hours', () => {
  const srt = '1\n01:02:03,500 --> 01:02:05,000\nLate in the video.\n';
  assert.equal(Transcript.parseSubtitles(srt)[0].start, 3723.5);
});

test('parseSubtitles returns null for plain text', () => {
  assert.equal(Transcript.parseSubtitles('just some words\nno cues here'), null);
});

test('parseSubtitles drops repeated auto-caption lines', () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nsame line\n\n00:00:02.000 --> 00:00:03.000\nsame line\n';
  assert.equal(Transcript.parseSubtitles(vtt).length, 1);
});

test('buildChunks groups unpunctuated captions into sentence-like chunks with start times', () => {
  const segs = Array.from({ length: 12 }, (_, i) => ({ start: i * 3, text: 'one two three four five' }));
  const chunks = Transcript.buildChunks(segs);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].start, 0);
  assert.match(chunks[0].text, /\.$/);
  assert.ok(chunks.every(c => c.text.split(' ').length <= 35));
});

test('findActionItems picks commitments, including "<Name> will"', () => {
  const chunks = [
    { start: 0, text: 'The weather was nice.' },
    { start: 10, text: 'Meera will send the mockups tomorrow.' },
    { start: 20, text: 'We need to finish load testing.' },
  ];
  const found = Transcript.findActionItems(chunks);
  assert.deepEqual(found.map(f => f.start), [10, 20]);
});

test('getActiveFor only returns the transcript while the text is unedited', () => {
  const loaded = Transcript.load([{ start: 0, text: 'Hello there everyone, welcome to the session today.' }], { source: 'file' });
  assert.ok(Transcript.getActiveFor(loaded.text));
  assert.equal(Transcript.getActiveFor(loaded.text + ' edited'), null);
  Transcript.reset();
});

test('formatTime handles minutes and hours', () => {
  assert.equal(Transcript.formatTime(65), '1:05');
  assert.equal(Transcript.formatTime(7325), '2:02:05');
});

// ─── Extractive engine ──────────────────────────────────────────────────

test('summary gets shorter as compression level increases', () => {
  const light = Summarizer.generateSummary(ARTICLE, 'light').summary.length;
  const aggressive = Summarizer.generateSummary(ARTICLE, 'aggressive').summary.length;
  assert.ok(aggressive < light);
});

test('summary keeps sentences in their original order', () => {
  const sentences = TextProcessor.tokenizeIntoSentences(ARTICLE);
  const summary = Summarizer.generateSummary(ARTICLE, 'light').summary;
  const positions = [...sentences].filter(s => summary.includes(s)).map(s => summary.indexOf(s));
  assert.ok(positions.length >= 2);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test('key points return the right source index even for duplicate sentences', () => {
  const dup = 'The launch is on Friday. ' + ARTICLE + ' The launch is on Friday.';
  const points = KeyPoints.extractKeyPointsDetailed(dup, 'light');
  const sentences = TextProcessor.tokenizeIntoSentences(dup);
  points.forEach(p => assert.ok(sentences[p.index].includes(p.text.replace(/\.$/, '').slice(0, 15))));
  const indices = [...points].map(p => p.index);   // [...] copies out of the vm realm
  assert.deepEqual(indices, [...indices].sort((a, b) => a - b));
});

test('presplit sentences are used as given (transcript chunks)', () => {
  const chunks = ['Alpha beta gamma delta epsilon zeta.', 'Eta theta iota kappa lambda mu.', 'Nu xi omicron pi rho sigma.'];
  const points = KeyPoints.extractKeyPointsDetailed('ignored', 'light', chunks);
  assert.ok(points.every(p => p.index >= 0 && p.index < chunks.length));
});

test('ranking a huge vocabulary does not overflow the call stack', () => {
  let text = '';
  for (let i = 0; i < 150000; i += 10) text += Array.from({ length: 10 }, (_, j) => 'term' + (i + j)).join(' ') + '. ';
  assert.doesNotThrow(() => TextProcessor.rankSentences(TextProcessor.tokenizeIntoSentences(text)));
});

// ─── Statistics ─────────────────────────────────────────────────────────

test('stats use exact token counts when provided', () => {
  const stats = Statistics.computeStats('a b c d', 'a b', [100, 25]);
  assert.equal(stats.tokensAreExact, true);
  assert.equal(stats.originalTokens, 100);
  assert.equal(stats.compressionRatio, 4);
  assert.equal(stats.contextReduction, 75);
  assert.equal(stats.tokensSaved, 75);
});

test('stats fall back to estimates and say so', () => {
  const stats = Statistics.computeStats(ARTICLE, 'Short summary here.');
  assert.equal(stats.tokensAreExact, false);
  assert.ok(stats.originalTokens > stats.compressedTokens);
});

test('formatTokens shows a tilde only for estimates', () => {
  assert.equal(Statistics.formatTokens(1234), '~1,234');
  assert.equal(Statistics.formatTokens(1234, true), '1,234');
});

test('Tokenizer.countWords ignores extra whitespace', () => {
  assert.equal(Tokenizer.countWords('  one   two\nthree '), 3);
});

// ─── Short texts (regression: a 59-second video got 6 key points and a poor score) ───

const ROCKET = [
  'Today I want to explain how a rocket engine actually works in simple terms.',
  'Fuel and oxidizer are pumped into a combustion chamber at very high pressure.',
  'When they burn, the gas expands and rushes out of the nozzle at enormous speed.',
  'Newton third law says that pushing the gas backward pushes the rocket forward.',
  'The nozzle shape matters because it turns pressure into directed velocity.',
  'Engineers cool the chamber walls with the fuel itself so the metal does not melt.',
  'Bigger rockets use several stages so they can drop empty tanks and become lighter.',
  'That is why a rocket can reach orbit even though each engine is limited by physics.',
  'So remember pressure, nozzle, thrust and staging, and you understand the whole idea.',
];

test('key points scale down for short texts', () => {
  const text = ROCKET.join(' ');
  const count = (level) => KeyPoints.extractKeyPointsDetailed(text, level, ROCKET).length;
  assert.ok(count('light') <= 5);
  assert.ok(count('balanced') <= 4);
  assert.equal(count('aggressive'), 2);
  assert.ok(count('aggressive') < count('balanced') && count('balanced') <= count('light'));
});

test('concept coverage falls as compression rises, and is not rigged by position', () => {
  const text = ROCKET.join(' ');
  const coverage = (level) => Preservation.evaluatePreservation(text, Summarizer.generateSummary(text, level, ROCKET).summary).percentage;
  const [light, balanced, aggressive] = ['light', 'balanced', 'aggressive'].map(coverage);
  assert.ok(light >= balanced && balanced >= aggressive);
  assert.ok(aggressive < 70, 'two of nine sentences cannot cover most concepts');
  assert.ok(light > aggressive);
});

test('keyword ties are broken by word length, not by where a word appears', () => {
  const top = [...TextProcessor.getTopKeywords(ROCKET.join(' '), 18)];
  assert.ok(!top.includes('today') || top.indexOf('today') > top.indexOf('pressure'));
});

test('coverage counts different forms of a word as the same concept', () => {
  const original = 'Compression reduces tokens. Compressing text saves money. Compressed context fits windows.';
  const result = Preservation.evaluatePreservation(original, 'We compress text.');
  assert.ok(result.matchedKeywords >= 1);
});

// ─── Video statistics ───────────────────────────────────────────────────

test('video stats use Gemini token counts and have no character counts', () => {
  const stats = Statistics.computeStats(null, 'a short summary of the video', null, {
    sourceIsVideo: true, originalTokens: 1000, compressedTokens: 100,
  });
  assert.equal(stats.sourceIsVideo, true);
  assert.equal(stats.originalChars, null);
  assert.equal(stats.originalWords, null);
  assert.equal(stats.tokensAreExact, true);
  assert.equal(stats.compressionRatio, 10);
  assert.equal(stats.contextReduction, 90);
});

test('unknown original size shows dashes instead of fake numbers', () => {
  const stats = Statistics.computeStats(null, 'summary words here', null, { sourceIsVideo: true, originalTokens: null, compressedTokens: 12 });
  assert.equal(stats.compressionRatio, null);
  assert.equal(stats.tokensSaved, null);
  assert.equal(Statistics.formatRatio(stats.compressionRatio), '—');
  assert.equal(Statistics.formatPercent(null), '—');
  assert.equal(Statistics.formatTokens(null), '—');
  assert.equal(stats.tokensAreExact, false);
});

// ─── Moments cited in video answers ──────────────────────────────────────

const refs = (text) => [...Transcript.splitTimeRefs(text)].map(p => ({ ...p }));

test('square-bracket citations become link targets', () => {
  const parts = refs('It starts at [0:12], then repeats [1:05].');
  assert.deepEqual(parts.filter(p => p.seconds !== null).map(p => p.seconds), [12, 65]);
  assert.equal(parts.map(p => p.text).join(''), 'It starts at [0:12], then repeats [1:05].', 'no text is lost');
});

test('round brackets and ranges are accepted, since models do not always follow the format', () => {
  assert.deepEqual(refs('Two kinds (10:58).').filter(p => p.seconds !== null).map(p => p.seconds), [658]);
  const range = refs('More dangerous [11:15-12:15] because…');
  assert.deepEqual(range.filter(p => p.seconds !== null).map(p => p.seconds), [675, 735]);
  assert.equal(range.map(p => p.text).join(''), 'More dangerous [11:15-12:15] because…');
  assert.deepEqual(refs('See [1:05, 2:10].').filter(p => p.seconds !== null).map(p => p.seconds), [65, 130]);
  assert.deepEqual(refs('At [1:02:03].').filter(p => p.seconds !== null).map(p => p.seconds), [3723]);
});

test('times outside brackets and non-times are left as plain text', () => {
  assert.deepEqual(refs('The meeting is at 5:30 pm, see [note] and [10].').filter(p => p.seconds !== null), []);
  assert.deepEqual(refs('plain text').map(p => p.text), ['plain text']);
});

test('cited moments are tagged so the page can drop the brackets around a link', () => {
  const kinds = refs('See [1:05].').map(p => `${p.kind}:${p.text}`);
  assert.deepEqual(kinds, ['text:See ', 'bracket:[', 'time:1:05', 'bracket:]', 'text:.']);
});
