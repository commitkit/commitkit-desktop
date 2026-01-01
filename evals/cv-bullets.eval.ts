/**
 * CV Bullet Quality Evals
 *
 * Tests LLM output quality using Evalite.
 * Run with: npm run evals
 *
 * Requires Ollama to be running locally with llama3.2 model.
 */

import { evalite } from 'evalite';
import { Levenshtein } from 'autoevals';

// Simple scorer: Does the bullet start with an action verb?
const startsWithActionVerb = (output: string): number => {
  const actionVerbs = [
    'implemented', 'developed', 'built', 'created', 'designed',
    'optimized', 'improved', 'enhanced', 'refactored', 'resolved',
    'fixed', 'reduced', 'increased', 'automated', 'streamlined',
    'integrated', 'deployed', 'migrated', 'architected', 'led',
    'delivered', 'established', 'launched', 'engineered', 'spearheaded',
  ];
  const firstWord = output.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
  return actionVerbs.includes(firstWord) ? 1.0 : 0.0;
};

// Simple scorer: Is the bullet concise?
const isConcise = (output: string): number => {
  const sentences = output.split(/[.!?]+/).filter(s => s.trim().length > 0);
  if (sentences.length <= 2 && output.length <= 300) return 1.0;
  if (sentences.length <= 3 && output.length <= 400) return 0.5;
  return 0.0;
};

// Import Ollama directly for the task
import { Ollama } from 'ollama';

const ollama = new Ollama({ host: 'http://localhost:11434' });

evalite('CV Bullet Quality', {
  data: async () => [
    {
      input: 'Fix null pointer exception in user service',
      expected: 'action verb, technical improvement',
    },
    {
      input: 'AUTH-123: Implement OAuth2 login for enterprise customers',
      expected: 'action verb, business value, authentication',
    },
    {
      input: 'Optimize database queries reducing load time by 60%',
      expected: 'action verb, quantified impact, performance',
    },
  ],

  task: async (input) => {
    const prompt = `Generate a professional CV/resume bullet point for this commit message.
The bullet should:
- Start with a strong action verb (Implemented, Developed, etc.)
- Be 1-2 sentences maximum
- Focus on business value

Commit: ${input}

Generate only the bullet point, nothing else:`;

    const response = await ollama.generate({
      model: 'llama3.2',
      prompt,
      options: { temperature: 0.7 },
    });

    return response.response.trim();
  },

  scorers: [
    {
      name: 'Starts with action verb',
      description: 'Checks if the bullet starts with a strong action verb',
      scorer: async ({ output }) => startsWithActionVerb(output),
    },
    {
      name: 'Is concise',
      description: 'Checks if the bullet is 1-2 sentences and under 300 chars',
      scorer: async ({ output }) => isConcise(output),
    },
  ],
});
