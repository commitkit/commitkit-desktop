/**
 * STAR Format Parsing Utilities
 *
 * Parse STAR (Situation-Task-Action-Result) format text from LLM output.
 */

export interface StarSections {
  situation?: string;
  task?: string;
  action?: string;
  result?: string;
}

/**
 * Parse STAR format text into sections
 * Expects format like:
 * **Situation:** ...
 * **Task:** ...
 * **Action:** ...
 * **Result:** ...
 */
export function parseStarFormat(text: string): StarSections | null {
  const situationMatch = text.match(/\*\*Situation:\*\*\s*([\s\S]*?)(?=\*\*Task:|\*\*Action:|\*\*Result:|$)/i);
  const taskMatch = text.match(/\*\*Task:\*\*\s*([\s\S]*?)(?=\*\*Situation:|\*\*Action:|\*\*Result:|$)/i);
  const actionMatch = text.match(/\*\*Action:\*\*\s*([\s\S]*?)(?=\*\*Situation:|\*\*Task:|\*\*Result:|$)/i);
  const resultMatch = text.match(/\*\*Result:\*\*\s*([\s\S]*?)$/i);

  if (!situationMatch && !taskMatch && !actionMatch) {
    return null; // Not STAR format
  }

  return {
    situation: situationMatch?.[1]?.trim() || undefined,
    task: taskMatch?.[1]?.trim() || undefined,
    action: actionMatch?.[1]?.trim() || undefined,
    result: resultMatch?.[1]?.trim() || undefined,
  };
}

/**
 * Check if text appears to be in STAR format
 */
export function isStarFormat(text: string): boolean {
  return parseStarFormat(text) !== null;
}

/**
 * Check if all four STAR sections are present
 */
export function hasCompleteStarFormat(text: string): boolean {
  const sections = parseStarFormat(text);
  if (!sections) return false;
  return !!(sections.situation && sections.task && sections.action && sections.result);
}
