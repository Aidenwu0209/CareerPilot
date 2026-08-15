import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { areToursDisabled, hasCompletedTour, useTourStore } from './tour-store';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

beforeEach(() => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', createMemoryStorage());
  useTourStore.setState({
    isActive: false,
    activeTourId: null,
    currentStep: 0,
    totalSteps: 0,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tour preferences', () => {
  it('dismisses one tour without disabling other tours', () => {
    useTourStore.getState().startTour('career', 4);
    useTourStore.getState().dismiss();

    expect(hasCompletedTour('career')).toBe(true);
    expect(hasCompletedTour('editor')).toBe(false);
    expect(areToursDisabled()).toBe(false);
  });

  it('lets the user disable every guided tour', () => {
    useTourStore.getState().startTour('career', 4);
    useTourStore.getState().dismissAll();

    expect(areToursDisabled()).toBe(true);
    expect(hasCompletedTour('career')).toBe(true);
    expect(hasCompletedTour('editor')).toBe(true);
    expect(useTourStore.getState().isActive).toBe(false);
  });
});
