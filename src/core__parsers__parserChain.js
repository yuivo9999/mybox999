import { ParserErrorCode, createResolvedMediaInput } from './core__models__parser.js';
import { ErrorCode } from './core__models__errors.js';
import { errorService } from './core__services__errorService.js';

export function createParserChain(parsers = []) {
  const ordered = [...parsers].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  return {
    list() {
      return [...ordered];
    },
    async resolve(candidate, context = {}) {
      if (!candidate?.mediaUrl && !candidate?.url) {
        throw new Error(ParserErrorCode.INPUT_INVALID);
      }

      if (candidate?.expiresAt) {
        const expiresAt = typeof candidate.expiresAt === 'number' ? candidate.expiresAt : Date.parse(candidate.expiresAt);
        if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) throw new Error(ParserErrorCode.SESSION_EXPIRED);
      }

      for (const parser of ordered) {
        if (!(await parser.matches(candidate, context))) continue;
        let result;
        try {
          result = await parser.resolve(candidate, context);
        } catch (error) {
          throw errorService.normalize(error, {
            code: ErrorCode.PARSE,
            context: { scope: 'parser', parser: parser.name ?? 'anonymous', candidateId: candidate.candidateId, sourceId: candidate.sourceId },
          });
        }
        if (!result) throw new Error(ParserErrorCode.PARSER_NOT_MATCHED);
        return createResolvedMediaInput(result);
      }

      throw new Error(ParserErrorCode.PARSER_NOT_MATCHED);
    },
  };
}
