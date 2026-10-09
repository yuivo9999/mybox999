import { createResolvedMediaInput, inferMediaProtocol } from './core__models__parser.js';

export const directParser = {
  id: 'direct',
  priority: 100,
  matches(candidate) {
    const protocol = String(candidate?.protocol ?? inferMediaProtocol(candidate?.mediaUrl ?? candidate?.url)).toLowerCase();
    return (!candidate?.parserHint || candidate.parserHint === 'direct' || typeof candidate.parserHint === 'object')
      && protocol !== 'hls'
      && protocol !== 'dash';
  },
  async resolve(candidate) {
    return createResolvedMediaInput({
      ...candidate,
      url: candidate.mediaUrl ?? candidate.url,
    });
  },
};
