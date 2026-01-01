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

// The STAR format prompt (same as in ollama.ts)
const buildStarPrompt = (epicName: string, tickets: string[], commits: string[]) => `
You are summarizing a software engineering project/feature for a CV/resume using the STAR format.

CONTEXT:
- ${commits.length} commits over this feature/project
- Epic: ${epicName}

JIRA TICKETS IN THIS FEATURE:
${tickets.map(t => `- ${t}`).join('\n')}

SAMPLE COMMIT MESSAGES:
${commits.map(c => `- ${c}`).join('\n')}

OUTPUT FORMAT - Generate a STAR format summary with these exact labels:

**Situation:** [1-2 sentences describing the business problem, user need, or opportunity that prompted this work.]

**Task:** [1 sentence describing your specific responsibility or goal.]

**Action:** [2-3 sentences describing what you actually built/implemented. Be specific about technologies.]

**Result:** [Leave this as a placeholder for the user to fill in with metrics]

STRICT RULES:
1. Use ONLY information from the JIRA tickets and commit messages
2. For Result, ALWAYS output exactly: "[Add metrics: e.g., reduced X by Y%, improved Z for N users]"

Generate the STAR format summary now:`;

evalite('STAR Format Quality', {
  data: async () => [
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
