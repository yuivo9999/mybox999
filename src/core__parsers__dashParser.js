import { MediaProtocol, createResolvedMediaInput } from './core__models__parser.js';

export const dashParser = {
  id: 'dash',
  priority: 30,
  matches(candidate) {
    const protocol = String(candidate?.protocol ?? '').toLowerCase();
    const url = String(candidate?.mediaUrl ?? candidate?.url ?? '').toLowerCase();
    return protocol === MediaProtocol.DASH || /\.mpd(?:$|[?#])/.test(url);
  },
  async resolve(candidate) {
    return createResolvedMediaInput({ ...candidate, url: candidate.mediaUrl ?? candidate.url, protocol: MediaProtocol.DASH });
  },
};
