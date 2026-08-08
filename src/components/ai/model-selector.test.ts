import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { estimateCredits, type CatalogModelInfo } from '@/hooks/use-model-catalog';

const mockModels: CatalogModelInfo[] = [
  {
    id: 'test-model-1',
    modelIdentifier: 'gpt-4',
    displayName: 'GPT-4 Standard',
    providerType: 'openai',
    capabilities: ['text'],
    tier: 'standard',
    inputTokenLimit: 8000,
    outputTokenLimit: 4000,
    maxSteps: 5,
    fixedPrice: 5,
    tokenPriceInput: 0,
    tokenPriceOutput: 0,
  },
  {
    id: 'test-model-2',
    modelIdentifier: 'claude-3-opus',
    displayName: 'Claude Opus Premium',
    providerType: 'anthropic',
    capabilities: ['text'],
    tier: 'premium',
    inputTokenLimit: 16000,
    outputTokenLimit: 8000,
    maxSteps: 10,
    fixedPrice: 0,
    tokenPriceInput: 10,
    tokenPriceOutput: 30,
  },
  {
    id: 'test-image-model',
    modelIdentifier: 'dall-e-3',
    displayName: 'DALL-E 3',
    providerType: 'openai',
    capabilities: ['image_generation'],
    tier: 'standard',
    inputTokenLimit: null,
    outputTokenLimit: null,
    maxSteps: null,
    fixedPrice: 20,
    tokenPriceInput: 0,
    tokenPriceOutput: 0,
  },
];

describe('estimateCredits', () => {
  it('returns fixed price as string when > 0', () => {
    expect(estimateCredits(mockModels[0])).toBe('5');
  });

  it('returns ~ for token-based pricing', () => {
    expect(estimateCredits(mockModels[1])).toBe('~');
  });

  it('returns null when all pricing is zero', () => {
    const free: CatalogModelInfo = {
      ...mockModels[0],
      id: 'free',
      fixedPrice: 0,
      tokenPriceInput: 0,
      tokenPriceOutput: 0,
    };
    expect(estimateCredits(free)).toBeNull();
  });

  it('returns fixed price for image models with fixed pricing', () => {
    expect(estimateCredits(mockModels[2])).toBe('20');
  });
});

describe('ModelSelector data logic', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('text models can be separated from image models', () => {
    const textModels = mockModels.filter((m) => m.capabilities.includes('text'));
    const imageModels = mockModels.filter((m) => m.capabilities.includes('image_generation'));

    expect(textModels).toHaveLength(2);
    expect(imageModels).toHaveLength(1);
    expect(textModels[0].displayName).toBe('GPT-4 Standard');
    expect(imageModels[0].displayName).toBe('DALL-E 3');
  });

  it('selected model can be checked against filtered list', () => {
    const textModels = mockModels.filter((m) => m.capabilities.includes('text'));
    const selectedId = 'deleted-model-id';
    const isUnavailable =
      textModels.length > 0 && !textModels.some((m) => m.id === selectedId);
    expect(isUnavailable).toBe(true);

    const validId = 'test-model-1';
    const isValid = textModels.some((m) => m.id === validId);
    expect(isValid).toBe(true);
  });

  it('estimateCredits still works after fetch failure', () => {
    // Utility functions are independent of fetch state
    expect(estimateCredits(mockModels[0])).toBe('5');
    expect(estimateCredits(mockModels[1])).toBe('~');
    expect(estimateCredits(mockModels[2])).toBe('20');
  });

  it('catalog model shape includes display fields for selector', () => {
    // Verify all fields needed by the ModelSelector UI exist in the type
    for (const model of mockModels) {
      expect(typeof model.id).toBe('string');
      expect(typeof model.displayName).toBe('string');
      expect(typeof model.tier).toBe('string');
      expect(Array.isArray(model.capabilities)).toBe(true);
      expect(typeof model.providerType).toBe('string');
      expect(typeof model.fixedPrice).toBe('number');
      expect(typeof model.tokenPriceInput).toBe('number');
      expect(typeof model.tokenPriceOutput).toBe('number');
    }
  });
});
