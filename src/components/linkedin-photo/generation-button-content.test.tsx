import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GenerationButtonContent } from './generation-button-content';

describe('GenerationButtonContent', () => {
  it('keeps both icon nodes mounted across generation state changes', () => {
    const idle = renderToStaticMarkup(
      <GenerationButtonContent
        isGenerating={false}
        generateLabel="Generate"
        generatingLabel="Generating"
      />,
    );
    const generating = renderToStaticMarkup(
      <GenerationButtonContent
        isGenerating
        generateLabel="Generate"
        generatingLabel="Generating"
      />,
    );

    expect(idle.match(/<svg/g)).toHaveLength(2);
    expect(generating.match(/<svg/g)).toHaveLength(2);
    expect(idle).toContain('Generate');
    expect(generating).toContain('Generating');
  });
});
