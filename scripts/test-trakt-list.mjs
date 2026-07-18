import assert from 'node:assert/strict';
import { buildListItems, summarizeAddResults } from '../api/lists/trakt.js';

const guide = [
  { show: 'Series A', season: 1, episode: 1, order: 1, traktIds: { trakt: 101 }, showTraktIds: { trakt: 10 } },
  { show: 'Series A', season: 1, episode: 2, order: 2, traktIds: { trakt: 102 }, showTraktIds: { trakt: 10 } },
  { show: 'Series A', season: 0, episode: 1, order: 3, isSpecial: true, traktIds: { trakt: 103 }, showTraktIds: { trakt: 10 } },
  { show: 'Movie B', season: 0, episode: 1, order: 4, isMovie: true, traktIds: { trakt: 20 }, showTraktIds: { trakt: 20 } },
  { show: 'Missing C', season: 1, episode: 1, order: 5, traktIds: {}, showTraktIds: {} },
  { show: 'Series A', season: 1, episode: 3, order: 6, airDate: '2999-01-01', traktIds: { trakt: 104 }, showTraktIds: { trakt: 10 } },
  { show: 'Series A', season: 1, episode: 4, order: 7, unaired: true, traktIds: { trakt: 105 }, showTraktIds: { trakt: 10 } }
];

const showMode = buildListItems(guide, ['Series A', 'Movie B', 'Missing C'], 'shows', false);
assert.equal(showMode.count, 2);
assert.deepEqual(showMode.payload.shows, [{ ids: { trakt: 10 } }]);
assert.deepEqual(showMode.payload.movies, [{ ids: { trakt: 20 } }]);
assert.equal(showMode.skipped.length, 1);

const episodeMode = buildListItems(guide, ['Series A', 'Movie B'], 'episodes', false);
assert.equal(episodeMode.count, 3);
assert.equal(episodeMode.payload.episodes.length, 2);
assert.equal(episodeMode.payload.movies.length, 1);

const withSpecials = buildListItems(guide, ['Series A', 'Movie B'], 'episodes', true);
assert.equal(withSpecials.count, 4);
assert.deepEqual(withSpecials.payload.episodes.map(item => item.ids.trakt), [101, 102, 103]);

const withUnreleased = buildListItems(guide, ['Series A', 'Movie B'], 'episodes', true, true);
assert.equal(withUnreleased.count, 6);
assert.deepEqual(withUnreleased.payload.episodes.map(item => item.ids.trakt), [101, 102, 103, 104, 105]);

const imdbFallback = buildListItems([
  { show: 'Movie D', season: 0, episode: 1, order: 1, isMovie: true, traktIds: { imdb: 'tt0164023' }, showTraktIds: { imdb: 'tt0164023' } }
], ['Movie D'], 'shows', false);
assert.equal(imdbFallback.count, 1);
assert.deepEqual(imdbFallback.payload.movies, [{ ids: { imdb: 'tt0164023' } }]);

const crossIdDuplicate = buildListItems([
  { show: 'Movie E', season: 0, episode: 1, order: 1, isMovie: true, traktIds: { trakt: 88, imdb: 'tt0000088' }, showTraktIds: { trakt: 88, imdb: 'tt0000088' } },
  { show: 'Movie F', season: 0, episode: 1, order: 2, isMovie: true, traktIds: { imdb: 'tt0000088' }, showTraktIds: { imdb: 'tt0000088' } }
], ['Movie E', 'Movie F'], 'shows', false);
assert.equal(crossIdDuplicate.count, 1);

const addSummary = summarizeAddResults([
  { added: { shows: 2, movies: 1 }, existing: { episodes: 1 }, not_found: { movies: [] } },
  { added: { episodes: 3 }, not_found: { shows: [{ ids: { imdb: 'tt0000000' } }] } }
]);
assert.equal(addSummary.present, 7);
assert.equal(addSummary.notFound, 1);

console.log('Trakt list item builder tests passed.');
