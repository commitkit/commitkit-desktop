/**
 * Simple CV Bullet Eval Runner
 *
 * Run with: npx ts-node evals/run-evals.ts
 * Or: OLLAMA_MODEL=qwen2.5:3b npx ts-node evals/run-evals.ts
 */

import { Ollama } from 'ollama';

const MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const ollama = new Ollama({ host: 'http://localhost:11434' });

// Test cases
const testCases = [
  'Fix null pointer exception in user service',
  'AUTH-123: Implement OAuth2 login for enterprise customers',
  'Optimize database queries reducing load time by 60%',
];

// Scorers
const actionVerbs = [
  'implemented', 'developed', 'built', 'created', 'designed',
  'optimized', 'improved', 'enhanced', 'refactored', 'resolved',
  'fixed', 'reduced', 'increased', 'automated', 'streamlined',
  'integrated', 'deployed', 'migrated', 'architected', 'led',
  'delivered', 'established', 'launched', 'engineered', 'spearheaded',
];

function startsWithActionVerb(output: string): boolean {
  const firstWord = output.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
  return actionVerbs.includes(firstWord);
}

function isConcise(output: string): boolean {
  const sentences = output.split(/[.!?]+/).filter(s => s.trim().length > 0);
  return sentences.length <= 2 && output.length <= 300;
}

function avoidsFirstPerson(output: string): boolean {
  return !/\b(I|my|we|our|me)\b/i.test(output);
}

async function generateBullet(commitMessage: string): Promise<string> {
  const prompt = `Generate a professional CV/resume bullet point for this commit message.
The bullet should:
- Start with a strong action verb (Implemented, Developed, etc.)
- Be 1-2 sentences maximum
- Focus on business value
- Use past tense

Commit: ${commitMessage}

Generate only the bullet point, nothing else:`;

  const response = await ollama.generate({
    model: MODEL,
    prompt,
    options: { temperature: 0.7 },
  });

  return response.response.trim();
}

async function runEvals() {
  console.log(`\n🧪 Running CV Bullet Evals with model: ${MODEL}\n`);
  console.log('='.repeat(60));

  let totalScore = 0;
  let maxScore = 0;

  for (const testCase of testCases) {
    console.log(`\n📝 Input: "${testCase}"`);

    try {
      const bullet = await generateBullet(testCase);
      console.log(`✨ Output: "${bullet}"`);

      // Score the output
      const scores = {
        actionVerb: startsWithActionVerb(bullet),
        concise: isConcise(bullet),
        noFirstPerson: avoidsFirstPerson(bullet),
      };

      const passed = Object.values(scores).filter(Boolean).length;
      const total = Object.keys(scores).length;
      totalScore += passed;
      maxScore += total;

      console.log(`📊 Scores:`);
      console.log(`   - Starts with action verb: ${scores.actionVerb ? '✅' : '❌'}`);
      console.log(`   - Is concise (<2 sentences): ${scores.concise ? '✅' : '❌'}`);
      console.log(`   - Avoids first person: ${scores.noFirstPerson ? '✅' : '❌'}`);
      console.log(`   Score: ${passed}/${total}`);
    } catch (error) {
      console.log(`❌ Error: ${error}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`\n📈 Overall Score: ${totalScore}/${maxScore} (${Math.round(totalScore/maxScore*100)}%)\n`);
}

runEvals().catch(console.error);
