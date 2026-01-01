/**
 * CV Bullet Quality Evals
 *
 * Tests LLM output quality using Evalite + autoevals.
 * Run with: npm run evals
 *
 * These tests require Ollama to be running locally.
 */

import { evalite } from 'evalite';
import { Factuality, Battle } from 'autoevals';
import { OllamaProvider } from '../src/services/ollama';
import { Commit, EnrichmentContext, JiraIssue } from '../src/types';

// Test cases with expected characteristics
const testCases = [
  {
    name: 'Simple bug fix',
    commit: {
      hash: 'abc123',
      message: 'Fix null pointer exception in user service',
      author: 'Jane Developer',
      email: 'jane@company.com',
      timestamp: new Date(),
    } as Commit,
    enrichments: {} as EnrichmentContext,
    expectedTraits: ['action verb', 'technical improvement'],
  },
  {
    name: 'Feature with JIRA context',
    commit: {
      hash: 'def456',
      message: 'AUTH-123: Implement OAuth2 login for enterprise customers',
      author: 'Jane Developer',
      email: 'jane@company.com',
      timestamp: new Date(),
    } as Commit,
    enrichments: {
      jira: {
        pluginId: 'jira',
        data: {
          issues: [{
            key: 'AUTH-123',
            summary: 'Add SSO support for enterprise tier',
            issueType: 'Story',
            status: 'Done',
            epicName: 'Enterprise Authentication',
            storyPoints: 8,
          }] as JiraIssue[],
        },
      },
    } as EnrichmentContext,
    expectedTraits: ['action verb', 'business value', 'enterprise', 'authentication'],
  },
  {
    name: 'Performance optimization',
    commit: {
      hash: 'ghi789',
      message: 'Optimize database queries reducing load time by 60%',
      author: 'Jane Developer',
      email: 'jane@company.com',
      timestamp: new Date(),
    } as Commit,
    enrichments: {} as EnrichmentContext,
    expectedTraits: ['action verb', 'quantified impact', 'performance'],
  },
];

// Custom scorer: Does the bullet start with an action verb?
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

// Custom scorer: Is the bullet concise (1-2 sentences)?
const isConcise = (output: string): number => {
  const sentences = output.split(/[.!?]+/).filter(s => s.trim().length > 0);
  if (sentences.length <= 2 && output.length <= 300) {
    return 1.0;
  } else if (sentences.length <= 3 && output.length <= 400) {
    return 0.5;
  }
  return 0.0;
};

// Custom scorer: Does it avoid first person (I, my, we)?
const avoidsFirstPerson = (output: string): number => {
  const firstPersonPatterns = /\b(I|my|we|our|me)\b/gi;
  const matches = output.match(firstPersonPatterns);
  return matches ? 0.0 : 1.0;
};

// Custom scorer: Does it contain quantified impact?
const hasQuantifiedImpact = (output: string): number => {
  const quantifiers = /(\d+%|\d+x|\$\d+|reduced by|increased by|improved by|\d+ (users|customers|requests|seconds|minutes|hours))/i;
  return quantifiers.test(output) ? 1.0 : 0.5; // 0.5 if no numbers (acceptable but not ideal)
};

// Main eval suite
evalite('CV Bullet Quality', {
  // This runs the actual LLM - requires Ollama running
  task: async (input: { commit: Commit; enrichments: EnrichmentContext }) => {
    const provider = new OllamaProvider();
    const bullet = await provider.generateCVBullet(input.commit, input.enrichments);
    return bullet.text;
  },

  data: () => testCases.map(tc => ({
    input: { commit: tc.commit, enrichments: tc.enrichments },
    expected: tc.expectedTraits.join(', '), // For reference
  })),

  scorers: [
    // Custom scorers with thresholds
    {
      name: 'Starts with action verb',
      scorer: async ({ output }) => ({
        score: startsWithActionVerb(output),
        metadata: { firstWord: output.trim().split(/\s+/)[0] },
      }),
    },
    {
      name: 'Is concise (1-2 sentences)',
      scorer: async ({ output }) => ({
        score: isConcise(output),
        metadata: { length: output.length },
      }),
    },
    {
      name: 'Avoids first person',
      scorer: async ({ output }) => ({
        score: avoidsFirstPerson(output),
      }),
    },
    {
      name: 'Has quantified impact',
      scorer: async ({ output }) => ({
        score: hasQuantifiedImpact(output),
      }),
    },
  ],

  // Minimum thresholds for passing
  threshold: 0.7, // 70% average score required
});

// Export for potential programmatic use
export { startsWithActionVerb, isConcise, avoidsFirstPerson, hasQuantifiedImpact };
