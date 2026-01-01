/**
 * Simple CV Bullet Eval Runner
 *
 * Run with sample data:
 *   npm run evals:simple
 *
 * Run with real commits from a repo:
 *   TEST_REPO=~/work-repo npm run evals:simple
 *   TEST_REPO=~/work-repo TEST_BRANCH=dev npm run evals:simple
 *
 * Specify Ollama model:
 *   OLLAMA_MODEL=qwen2.5:3b npm run evals:simple
 */

import { Ollama } from 'ollama';
import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';

const MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const ollama = new Ollama({ host: 'http://localhost:11434' });

// Expand ~ to home directory
const expandTilde = (p: string) => p.startsWith('~') ? p.replace('~', os.homedir()) : p;

// Auto-detect main branch
function detectMainBranch(repoPath: string): string {
  if (process.env.TEST_BRANCH) {
    return process.env.TEST_BRANCH;
  }
  try {
    execSync(`git rev-parse --verify main`, { cwd: repoPath, stdio: 'ignore' });
    return 'main';
  } catch {
    try {
      execSync(`git rev-parse --verify master`, { cwd: repoPath, stdio: 'ignore' });
      return 'master';
    } catch {
      return 'main';
    }
  }
}

// Get commits from a git repo
function getCommitsFromRepo(repoPath: string, branch: string, maxCount: number = 5): string[] {
  try {
    const output = execSync(
      `git log ${branch} --pretty=format:"%s" -n ${maxCount}`,
      { cwd: repoPath, encoding: 'utf-8' }
    );
    return output.trim().split('\n').filter(m => m.length > 0);
  } catch (error) {
    console.error(`Failed to read commits from ${repoPath}:`, error);
    return [];
  }
}

// Sample test cases (used when no TEST_REPO provided)
const sampleTestCases = [
  'Fix null pointer exception in user service',
  'AUTH-123: Implement OAuth2 login for enterprise customers',
  'Optimize database queries reducing load time by 60%',
];

// Get test cases - either from repo or samples
function getTestCases(): { commits: string[]; source: string } {
  if (process.env.TEST_REPO) {
    const repoPath = path.resolve(expandTilde(process.env.TEST_REPO));
    const branch = detectMainBranch(repoPath);
    const commits = getCommitsFromRepo(repoPath, branch, 5);
    if (commits.length > 0) {
      return { commits, source: `${repoPath} (${branch})` };
    }
  }
  return { commits: sampleTestCases, source: 'sample data' };
}

// Scorers
const actionVerbs = [
  'implemented', 'developed', 'built', 'created', 'designed',
  'optimized', 'improved', 'enhanced', 'refactored', 'resolved',
  'fixed', 'reduced', 'increased', 'automated', 'streamlined',
  'integrated', 'deployed', 'migrated', 'architected', 'led',
  'delivered', 'established', 'launched', 'engineered', 'spearheaded',
];

function startsWithActionVerb(output: string): boolean {
  // Strip leading bullet characters (•, -, *, etc.) before checking
  const cleaned = output.trim().replace(/^[\s\-\*•·▪▸►]+/, '').trim();
  const firstWord = cleaned.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
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
  const { commits, source } = getTestCases();

  console.log(`\n🧪 Running CV Bullet Evals`);
  console.log(`   Model: ${MODEL}`);
  console.log(`   Source: ${source}`);
  console.log(`   Commits: ${commits.length}`);
  console.log('\n' + '='.repeat(60));

  let totalScore = 0;
  let maxScore = 0;

  for (const testCase of commits) {
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
