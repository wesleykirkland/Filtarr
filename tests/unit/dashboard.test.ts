import { describe, expect, it } from 'vitest';
import { buildDashboardSummary } from '../../src/client/lib/dashboard.js';

describe('buildDashboardSummary', () => {
  it('guides the user to add an instance first when nothing is configured', () => {
    const summary = buildDashboardSummary({ instances: [], filters: [], jobs: [] });

    expect(summary.instanceCount).toBe(0);
    expect(summary.automationReady).toBe(false);
    expect(summary.nextStep.href).toBe('/instances');
    expect(summary.nextStep.cta).toBe('Add instance');
  });

  it('asks the user to fix target paths before scheduling when active filters are incomplete', () => {
    const summary = buildDashboardSummary({
      instances: [{ enabled: 1 }],
      filters: [{ enabled: 1, target_path: null }],
      jobs: [],
    });

    expect(summary.activeFilterCount).toBe(1);
    expect(summary.filtersMissingTargetPath).toBe(1);
    expect(summary.nextStep.href).toBe('/filters');
    expect(summary.nextStep.cta).toBe('Fix filter paths');
  });

  it('marks automation ready when active instances, filters, target paths, and jobs are all present', () => {
    const summary = buildDashboardSummary({
      instances: [{ enabled: 1 }],
      filters: [{ enabled: 1, target_path: '/downloads/complete' }],
      jobs: [{ enabled: true }],
    });

    expect(summary.automationReady).toBe(true);
    expect(summary.enabledJobCount).toBe(1);
    expect(summary.nextStep.href).toBe('/activity');
    expect(summary.readiness.every((item) => item.complete)).toBe(true);
  });
});