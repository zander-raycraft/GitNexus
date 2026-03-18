/**
 * CI Workflow Tests: GitHub Actions YAML validation
 *
 * Validates the two Claude-powered workflow files:
 * - .github/workflows/claude.yml (interactive @claude mentions)
 * - .github/workflows/claude-code-review.yml (auto-review on PRs)
 *
 * Checks YAML structure, SHA-pinned action refs, permissions,
 * trigger events, fork PR security guard, and step structure.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WORKFLOW_DIR = resolve(__dirname, '../../../.github/workflows');

const WORKFLOW_FILES = [
  { name: 'claude.yml', path: resolve(WORKFLOW_DIR, 'claude.yml') },
  { name: 'claude-code-review.yml', path: resolve(WORKFLOW_DIR, 'claude-code-review.yml') },
] as const;

const EXPECTED_SHA_REF = 'luccabb/claude-code-action@7f39722b8a782471258f32e1d5a9a531b2b68056';

/** Read a workflow file and return its raw content. */
function readWorkflow(filePath: string): string {
  return readFileSync(filePath, 'utf-8');
}

// ─── YAML validity ──────────────────────────────────────────────────

describe('YAML validity', () => {
  for (const wf of WORKFLOW_FILES) {
    describe(wf.name, () => {
      it('reads without error', () => {
        expect(() => readWorkflow(wf.path)).not.toThrow();
      });

      it('has top-level "name" key', () => {
        const content = readWorkflow(wf.path);
        expect(content).toMatch(/^name:\s/m);
      });

      it('has top-level "on" key', () => {
        const content = readWorkflow(wf.path);
        expect(content).toMatch(/^on:\s/m);
      });

      it('has top-level "jobs" key', () => {
        const content = readWorkflow(wf.path);
        expect(content).toMatch(/^jobs:\s/m);
      });
    });
  }
});

// ─── Action SHA pinning ─────────────────────────────────────────────

describe('Action SHA pinning', () => {
  for (const wf of WORKFLOW_FILES) {
    describe(wf.name, () => {
      const content = readWorkflow(wf.path);
      // Extract all `uses:` lines that reference claude-code-action
      const claudeActionLines = content
        .split('\n')
        .filter((line) => line.includes('uses:') && line.includes('claude-code-action'));

      it('has at least one claude-code-action reference', () => {
        expect(claudeActionLines.length).toBeGreaterThanOrEqual(1);
      });

      it(`pins claude-code-action to exact SHA: ${EXPECTED_SHA_REF}`, () => {
        for (const line of claudeActionLines) {
          expect(line).toContain(EXPECTED_SHA_REF);
        }
      });

      it('does not use tag-style refs (@v1, @main, @latest)', () => {
        for (const line of claudeActionLines) {
          // After extracting the ref, ensure it's not a short tag
          expect(line).not.toMatch(/claude-code-action@v\d/);
          expect(line).not.toMatch(/claude-code-action@main/);
          expect(line).not.toMatch(/claude-code-action@latest/);
        }
      });
    });
  }
});

// ─── Permissions ────────────────────────────────────────────────────

describe('Permissions', () => {
  for (const wf of WORKFLOW_FILES) {
    describe(wf.name, () => {
      const content = readWorkflow(wf.path);

      it('grants pull-requests: write', () => {
        expect(content).toMatch(/pull-requests:\s*write/);
      });

      it('grants issues: write', () => {
        expect(content).toMatch(/issues:\s*write/);
      });

      it('grants id-token: write', () => {
        expect(content).toMatch(/id-token:\s*write/);
      });

      it('keeps contents: read (not write)', () => {
        expect(content).toMatch(/contents:\s*read/);
        // Ensure no contents: write exists
        expect(content).not.toMatch(/contents:\s*write/);
      });
    });
  }
});

// ─── Trigger events ─────────────────────────────────────────────────

describe('Trigger events', () => {
  describe('claude.yml', () => {
    const content = readWorkflow(WORKFLOW_FILES[0].path);

    const expectedTriggers = [
      'issue_comment',
      'pull_request_review_comment',
      'issues',
      'pull_request_review',
    ];

    for (const trigger of expectedTriggers) {
      it(`triggers on ${trigger}`, () => {
        // Match as a top-level key under `on:` (2-space indented)
        expect(content).toMatch(new RegExp(`^\\s{2}${trigger}:`, 'm'));
      });
    }
  });

  describe('claude-code-review.yml', () => {
    const content = readWorkflow(WORKFLOW_FILES[1].path);

    it('triggers on pull_request_target only (not pull_request — avoids double-fire)', () => {
      expect(content).toMatch(/^\s{2}pull_request_target:/m);
      // pull_request must NOT be a trigger — it would double-fire for same-repo PRs
      expect(content).not.toMatch(/^\s{2}pull_request:/m);
    });
  });
});

// ─── Fork PR security guard ────────────────────────────────────────

describe('Fork PR security guard', () => {
  describe('claude-code-review.yml', () => {
    const content = readWorkflow(WORKFLOW_FILES[1].path);

    it('has an active (non-commented) if: condition on the job', () => {
      // The `if:` must appear at the job level (4-space indent), not commented out
      expect(content).toMatch(/^\s{4}if:\s*\|/m);
    });

    it('references author_association in the condition', () => {
      expect(content).toContain('author_association');
    });

    it('allows OWNER, MEMBER, and COLLABORATOR', () => {
      expect(content).toContain("'OWNER'");
      expect(content).toContain("'MEMBER'");
      expect(content).toContain("'COLLABORATOR'");
    });

    it('guards against untrusted authors via author_association check', () => {
      // The if: condition must check author_association directly since
      // pull_request_target is now the only trigger — no event_name branching needed
      expect(content).toMatch(/author_association\s*==\s*'OWNER'/);
      expect(content).toMatch(/author_association\s*==\s*'MEMBER'/);
      expect(content).toMatch(/author_association\s*==\s*'COLLABORATOR'/);
    });
  });
});

// ─── Step structure ─────────────────────────────────────────────────

describe('Step structure', () => {
  for (const wf of WORKFLOW_FILES) {
    describe(wf.name, () => {
      const content = readWorkflow(wf.path);

      // Count steps by matching `- name:` lines under `steps:`
      const stepMatches = content.match(/^\s{6}- name:/gm) || [];

      it('has exactly 2 steps', () => {
        expect(stepMatches.length).toBe(2);
      });

      it('first step uses actions/checkout', () => {
        // Find first `uses:` line after `steps:`
        const stepsIndex = content.indexOf('steps:');
        const afterSteps = content.slice(stepsIndex);
        const firstUsesMatch = afterSteps.match(/uses:\s*(\S+)/);
        expect(firstUsesMatch).not.toBeNull();
        expect(firstUsesMatch![1]).toMatch(/^actions\/checkout@/);
      });

      it('no step references git/refs API (old broken pattern)', () => {
        expect(content).not.toContain('git/refs');
      });
    });
  }
});
