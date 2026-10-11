import { createParserChain } from './core__parsers__parserChain.js';
import { directParser } from './core__parsers__directParser.js';
import { hlsParser } from './core__parsers__hlsParser.js';
import { dashParser } from './core__parsers__dashParser.js';
import { createTVBoxConfiguredParser } from './core__parsers__tvboxConfiguredParser.js';
export const parserService = {
  chain: createParserChain([hlsParser, dashParser, directParser]),
  resolve(candidate, options = {}) {
    const configured = candidate?.metadata?.tvboxParseConfig;
    if (configured?.parses?.length) {
      const configuredParser = createTVBoxConfiguredParser(configured);
      return createParserChain([configuredParser, hlsParser, dashParser, directParser]).resolve(candidate, options);
    }
    return this.chain.resolve(candidate, options);
  },
};
