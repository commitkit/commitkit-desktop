/**
 * STAR Format Quality Evals
 *
 * Tests LLM output quality for STAR format feature bullets.
 * Run with: npm run evals
 *
 * Requires Ollama to be running locally.
 */

import { evalite } from 'evalite';
import { Ollama } from 'ollama';
import { parseStarFormat, hasCompleteStarFormat } from '../src/utils/star-format';
import { buildStarPrompt } from '../src/services/ollama';

const ollama = new Ollama({ host: 'http://localhost:11434' });
const MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

// Scorer: Does output have all STAR sections?
const hasAllStarSections = (output: string): number => {
  return hasCompleteStarFormat(output) ? 1.0 : 0.0;
};

// Scorer: Does Situation describe a business problem?
const situationHasContext = (output: string): number => {
  const sections = parseStarFormat(output);
  if (!sections?.situation) return 0.0;

  const contextKeywords = [
    'need', 'required', 'problem', 'challenge', 'issue',
    'lacked', 'manual', 'inefficient', 'difficult', 'complex',
    'users', 'customers', 'team', 'system', 'platform',
  ];

  const lowerSituation = sections.situation.toLowerCase();
  const hasContext = contextKeywords.some(kw => lowerSituation.includes(kw));
  return hasContext ? 1.0 : 0.5;
};

// Scorer: Does Action mention technical details?
const actionHasTechnicalDetails = (output: string): number => {
  const sections = parseStarFormat(output);
  if (!sections?.action) return 0.0;

  const technicalKeywords = [
    'api', 'database', 'service', 'component', 'endpoint',
    'implemented', 'built', 'developed', 'created', 'designed',
    'integrated', 'deployed', 'optimized', 'refactored',
    'rest', 'frontend', 'backend', 'authentication', 'authorization',
  ];

  const lowerAction = sections.action.toLowerCase();
  const hasTechnical = technicalKeywords.some(kw => lowerAction.includes(kw));
  return hasTechnical ? 1.0 : 0.5;
};

// Scorer: Does Result have placeholder for metrics?
const resultHasPlaceholder = (output: string): number => {
  const sections = parseStarFormat(output);
  if (!sections?.result) return 0.0;

  const hasPlaceholder = sections.result.includes('[') ||
    sections.result.toLowerCase().includes('add metrics') ||
    sections.result.includes('%');

  return hasPlaceholder ? 1.0 : 0.5;
};

// Quality threshold: all scorers must average at least 0.7
const QUALITY_THRESHOLD = 0.7;

evalite('STAR Format Quality', {
  threshold: QUALITY_THRESHOLD,

  data: async () => [
    // Test case 1: Content management feature
    {
      input: {
        epicName: 'Find and Replace Feature',
        tickets: [
          'PROJ-100: Implement find and replace for content types',
          'PROJ-101: Add search history',
          'PROJ-102: Implement bulk replacement',
        ],
        commits: [
          'PROJ-100: Add search endpoint',
          'PROJ-100: Add replace functionality',
          'PROJ-101: Implement history tracking',
          'PROJ-102: Add batch processing',
        ],
      },
      expected: 'Complete STAR with situation, task, action, result',
    },
    // Test case 2: AI/ML feature
    {
      input: {
        epicName: 'AI Grading System',
        tickets: [
          'PROJ-200: Implement AI grading for text responses',
          'PROJ-201: Add grading status tracking',
        ],
        commits: [
          'PROJ-200: Add NLP grading service',
          'PROJ-200: Integrate with LLM provider',
          'PROJ-201: Add status management',
        ],
      },
      expected: 'Complete STAR with AI/technical details',
    },
    // Test case 3: Authentication/Security feature
    {
      input: {
        epicName: 'SSO Integration',
        tickets: [
          'SEC-50: Implement SAML SSO for enterprise customers',
          'SEC-51: Add OAuth2 fallback authentication',
          'SEC-52: Create SSO configuration admin panel',
        ],
        commits: [
          'SEC-50: Add SAML service provider',
          'SEC-50: Implement assertion consumer endpoint',
          'SEC-51: Add OAuth2 authorization flow',
          'SEC-52: Build SSO settings UI',
          'SEC-52: Add SSO testing mode',
        ],
      },
      expected: 'Complete STAR with security/authentication context',
    },
    // Test case 4: Performance optimization
    {
      input: {
        epicName: 'Database Performance Optimization',
        tickets: [
          'PERF-30: Optimize slow report queries',
          'PERF-31: Add caching layer for dashboard',
        ],
        commits: [
          'PERF-30: Add database indexes',
          'PERF-30: Refactor N+1 queries',
          'PERF-31: Implement Redis caching',
          'PERF-31: Add cache invalidation',
        ],
      },
      expected: 'Complete STAR with performance/technical details',
    },
    // Test case 5: API development
    {
      input: {
        epicName: 'Public API v2',
        tickets: [
          'API-100: Design REST API v2 endpoints',
          'API-101: Implement rate limiting',
          'API-102: Add API key authentication',
          'API-103: Create API documentation',
        ],
        commits: [
          'API-100: Add v2 controllers',
          'API-100: Implement pagination',
          'API-101: Add rate limiter middleware',
          'API-102: Create API key model',
          'API-103: Generate OpenAPI spec',
        ],
      },
      expected: 'Complete STAR with API development context',
    },
    // Test case 6: Frontend/UI feature
    {
      input: {
        epicName: 'Dashboard Redesign',
        tickets: [
          'UI-200: Redesign main dashboard layout',
          'UI-201: Add customizable widgets',
          'UI-202: Implement dark mode',
        ],
        commits: [
          'UI-200: Create new dashboard grid',
          'UI-200: Add responsive breakpoints',
          'UI-201: Build widget system',
          'UI-201: Add drag-and-drop',
          'UI-202: Implement theme provider',
        ],
      },
      expected: 'Complete STAR with frontend/UI context',
    },
    // Test case 7: Small feature (edge case - minimal input)
    {
      input: {
        epicName: 'Export Feature',
        tickets: [
          'FEAT-10: Add CSV export for reports',
        ],
        commits: [
          'FEAT-10: Add export endpoint',
          'FEAT-10: Format CSV output',
        ],
      },
      expected: 'Complete STAR even with minimal input',
    },
    // Test case 8: Integration feature
    {
      input: {
        epicName: 'Slack Integration',
        tickets: [
          'INT-40: Build Slack notification service',
          'INT-41: Add Slack OAuth app connection',
          'INT-42: Create notification preferences UI',
        ],
        commits: [
          'INT-40: Add Slack API client',
          'INT-40: Implement message templates',
          'INT-41: Add OAuth callback handler',
          'INT-42: Build preferences form',
        ],
      },
      expected: 'Complete STAR with integration context',
    },
  ],

  task: async (input) => {
    const { epicName, tickets, commits } = input;
    const prompt = buildStarPrompt(epicName, tickets, commits);

    const response = await ollama.generate({
      model: MODEL,
      prompt,
      options: { temperature: 0.7 },
    });

    return response.response.trim();
  },

  scorers: [
    {
      name: 'Has all STAR sections',
      description: 'Checks if output has Situation, Task, Action, and Result',
      scorer: async ({ output }) => hasAllStarSections(output),
    },
    {
      name: 'Situation has context',
      description: 'Checks if Situation describes business problem/need',
      scorer: async ({ output }) => situationHasContext(output),
    },
    {
      name: 'Action has technical details',
      description: 'Checks if Action mentions specific technical work',
      scorer: async ({ output }) => actionHasTechnicalDetails(output),
    },
    {
      name: 'Result has placeholder',
      description: 'Checks if Result prompts user to add metrics',
      scorer: async ({ output }) => resultHasPlaceholder(output),
    },
  ],
});
