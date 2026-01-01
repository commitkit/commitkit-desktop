/**
 * STAR Format Parsing Tests
 */

import { parseStarFormat, isStarFormat, hasCompleteStarFormat } from '../../src/utils/star-format';

describe('parseStarFormat', () => {
  it('should parse complete STAR format', () => {
    const text = `**Situation:** The team needed a new authentication system.

**Task:** Design and implement OAuth2 integration.

**Action:** Built a comprehensive auth service with token refresh.

**Result:** [Add metrics: e.g., reduced login failures by 50%]`;

    const result = parseStarFormat(text);

    expect(result).not.toBeNull();
    expect(result?.situation).toBe('The team needed a new authentication system.');
    expect(result?.task).toBe('Design and implement OAuth2 integration.');
    expect(result?.action).toBe('Built a comprehensive auth service with token refresh.');
    expect(result?.result).toBe('[Add metrics: e.g., reduced login failures by 50%]');
  });

  it('should handle multiline sections', () => {
    const text = `**Situation:** The content management system lacked
a centralized mechanism for bulk updates, requiring
administrators to manually update each item.

**Task:** Build a find-and-replace feature.

**Action:** Implemented the feature.

**Result:** Reduced update time.`;

    const result = parseStarFormat(text);

    expect(result?.situation).toContain('centralized mechanism');
    expect(result?.situation).toContain('manually update');
  });

  it('should return null for non-STAR format text', () => {
    const text = 'Implemented a new feature for the dashboard that allows users to track metrics.';

    const result = parseStarFormat(text);

    expect(result).toBeNull();
  });

  it('should handle partial STAR format (missing sections)', () => {
    const text = `**Situation:** Need to improve performance.

**Action:** Optimized database queries.`;

    const result = parseStarFormat(text);

    expect(result).not.toBeNull();
    expect(result?.situation).toBe('Need to improve performance.');
    expect(result?.task).toBeUndefined();
    expect(result?.action).toBe('Optimized database queries.');
    expect(result?.result).toBeUndefined();
  });

  it('should handle different casing in labels', () => {
    const text = `**SITUATION:** Uppercase labels.

**Task:** Mixed case.

**action:** Lowercase.

**Result:** All should work.`;

    const result = parseStarFormat(text);

    expect(result?.situation).toBe('Uppercase labels.');
    expect(result?.task).toBe('Mixed case.');
    expect(result?.action).toBe('Lowercase.');
    expect(result?.result).toBe('All should work.');
  });

  it('should handle extra whitespace', () => {
    const text = `**Situation:**    Lots of spaces.

**Task:**   More spaces.

**Action:**

Some action text.

**Result:** Final result.`;

    const result = parseStarFormat(text);

    expect(result?.situation).toBe('Lots of spaces.');
    expect(result?.task).toBe('More spaces.');
    expect(result?.action).toBe('Some action text.');
  });

  it('should handle Result placeholder format', () => {
    const text = `**Situation:** Context here.

**Task:** Task here.

**Action:** Action here.

**Result:** [Add metrics: e.g., reduced X by Y%, improved Z for N users]`;

    const result = parseStarFormat(text);

    expect(result?.result).toContain('[Add metrics');
    expect(result?.result).toContain('reduced X by Y%');
  });
});

describe('isStarFormat', () => {
  it('should return true for STAR format text', () => {
    const text = `**Situation:** Test.
**Task:** Test.
**Action:** Test.
**Result:** Test.`;

    expect(isStarFormat(text)).toBe(true);
  });

  it('should return false for non-STAR text', () => {
    expect(isStarFormat('Regular bullet point text.')).toBe(false);
  });

  it('should return true for partial STAR format', () => {
    const text = `**Situation:** Only situation.
**Action:** And action.`;

    expect(isStarFormat(text)).toBe(true);
  });
});

describe('hasCompleteStarFormat', () => {
  it('should return true when all four sections present', () => {
    const text = `**Situation:** S.
**Task:** T.
**Action:** A.
**Result:** R.`;

    expect(hasCompleteStarFormat(text)).toBe(true);
  });

  it('should return false when missing sections', () => {
    const text = `**Situation:** S.
**Task:** T.
**Action:** A.`;

    expect(hasCompleteStarFormat(text)).toBe(false);
  });

  it('should return false for non-STAR text', () => {
    expect(hasCompleteStarFormat('Regular text')).toBe(false);
  });

  it('should return false for empty sections', () => {
    const text = `**Situation:** S.
**Task:** T.
**Action:** A.
**Result:**`;

    expect(hasCompleteStarFormat(text)).toBe(false);
  });
});
