import { JUDGE_DIMENSIONS, type JudgeDimension } from './eval-aggregate.ts';

export const JUDGE_TEMPERATURE = 0;

export interface JudgePin {
  modelId: string;
  modelVersion: string;
  apiKey: string;
}

export interface JudgeRequest {
  caseId: string;
  candidateText: string;
  rubricName: string;
  referenceFacts: readonly string[];
  mustPreserve: readonly string[];
}

export interface JudgeDimensionVerdict {
  pass: boolean;
  evidence: string[];
}

export interface JudgeVerdict {
  dimensions: Record<JudgeDimension, JudgeDimensionVerdict>;
}

export interface JudgeClient {
  readonly pin: JudgePin;
  readonly temperature: typeof JUDGE_TEMPERATURE;
  judge(request: JudgeRequest, pin?: JudgePin): Promise<JudgeVerdict>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredEnv(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`judge pin: ${key} is required`);
  }
  return value;
}

export function parseJudgePin(env: Record<string, string | undefined>): JudgePin {
  const modelId = requiredEnv(env, 'JUDGE_MODEL');
  const modelVersion = requiredEnv(env, 'JUDGE_MODEL_VERSION');
  const apiKey = requiredEnv(env, 'JUDGE_API_KEY');
  const generatorModel = env.GENERATOR_MODEL;
  if (typeof generatorModel === 'string' && generatorModel.trim() !== '' && generatorModel === modelId) {
    throw new Error('judge pin: JUDGE_MODEL must differ from GENERATOR_MODEL');
  }
  return { modelId, modelVersion, apiKey };
}

export function parseJudgeVerdict(raw: unknown): JudgeVerdict {
  if (!isPlainObject(raw)) {
    throw new Error('judge verdict: must be an object');
  }
  if (!isPlainObject(raw.dimensions)) {
    throw new Error('judge verdict: "dimensions" must be an object');
  }
  const dimensions = {} as Record<JudgeDimension, JudgeDimensionVerdict>;
  for (const dimension of JUDGE_DIMENSIONS) {
    const entry = raw.dimensions[dimension];
    if (!isPlainObject(entry)) {
      throw new Error(`judge verdict: missing dimension "${dimension}"`);
    }
    if (typeof entry.pass !== 'boolean') {
      throw new Error(`judge verdict: "${dimension}.pass" must be a boolean`);
    }
    if (!Array.isArray(entry.evidence) || entry.evidence.some((item) => typeof item !== 'string')) {
      throw new Error(`judge verdict: "${dimension}.evidence" must be a string array`);
    }
    dimensions[dimension] = {
      pass: entry.pass,
      evidence: entry.evidence as string[],
    };
  }
  return { dimensions };
}

export function createMockJudgeClient(
  script: (request: JudgeRequest) => Promise<unknown>,
  pin: JudgePin = {
    modelId: 'mock-judge',
    modelVersion: 'test',
    apiKey: 'mock',
  },
): JudgeClient {
  return {
    pin,
    temperature: JUDGE_TEMPERATURE,
    async judge(request: JudgeRequest): Promise<JudgeVerdict> {
      return parseJudgeVerdict(await script(request));
    },
  };
}

/** OpenAI-compatible chat completions adapter. Not used by unit tests. */
export function createHttpJudgeClient(options: {
  pin: JudgePin;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): JudgeClient {
  const baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    pin: options.pin,
    temperature: JUDGE_TEMPERATURE,
    async judge(request: JudgeRequest, pin = options.pin): Promise<JudgeVerdict> {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${pin.apiKey}`,
        },
        body: JSON.stringify({
          model: pin.modelId,
          temperature: JUDGE_TEMPERATURE,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'Score the candidate against the rubric. Return JSON only: {"dimensions":{"factual_fidelity":{"pass":bool,"evidence":[string]},"constraint_compliance":{"pass":bool,"evidence":[string]},"reader_follow_up_need":{"pass":bool,"evidence":[string]}}}.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                case_id: request.caseId,
                rubric: request.rubricName,
                reference_facts: request.referenceFacts,
                must_preserve: request.mustPreserve,
                candidate: request.candidateText,
                judge_model_version: pin.modelVersion,
              }),
            },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(`judge HTTP ${response.status}`);
      }
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim() === '') {
        throw new Error('judge verdict: empty model content');
      }
      return parseJudgeVerdict(JSON.parse(content) as unknown);
    },
  };
}
