import { describe, expect, it } from 'vitest';
import { ensureSectionLayoutDefaults } from '@converter/exporter.js';

const DEFAULT_WIDTH = '12240';
const DEFAULT_HEIGHT = '15840';
const DEFAULT_MARGINS = {
  'w:top': '1440',
  'w:right': '1440',
  'w:bottom': '1440',
  'w:left': '1440',
  'w:header': '720',
  'w:footer': '720',
  'w:gutter': '0',
};

const getElement = (sectPr, name) => sectPr.elements.find((el) => el.name === name);

describe('ensureSectionLayoutDefaults', () => {
  it('creates a new sectPr when none provided', () => {
    const result = ensureSectionLayoutDefaults({ name: 'w:sectPr', elements: [] }, {});

    expect(Array.isArray(result.elements)).toBe(true);
    expect(result.name).toBe('w:sectPr');
    const pgSz = getElement(result, 'w:pgSz');
    expect(pgSz).toBeDefined();
    expect(pgSz.attributes['w:w']).toBe(DEFAULT_WIDTH);
    expect(pgSz.attributes['w:h']).toBe(DEFAULT_HEIGHT);

    const pgMar = getElement(result, 'w:pgMar');
    expect(pgMar).toBeDefined();
    expect(pgMar.attributes).toEqual(DEFAULT_MARGINS);
  });

  it('fills in missing size and margin attributes while preserving existing ones', () => {
    const sectPr = {
      name: 'w:sectPr',
      elements: [
        { name: 'w:pgSz', attributes: { 'w:w': '8000' } },
        { name: 'w:pgMar', attributes: { 'w:top': '500' } },
      ],
    };

    const result = ensureSectionLayoutDefaults(sectPr, {});

    const pgSz = getElement(result, 'w:pgSz');
    expect(pgSz.attributes['w:w']).toBe('8000');
    expect(pgSz.attributes['w:h']).toBe(DEFAULT_HEIGHT);

    const pgMar = getElement(result, 'w:pgMar');
    expect(pgMar.attributes['w:top']).toBe('500');
    expect(pgMar.attributes['w:right']).toBe(DEFAULT_MARGINS['w:right']);
    expect(pgMar.attributes['w:bottom']).toBe(DEFAULT_MARGINS['w:bottom']);
    expect(pgMar.attributes['w:left']).toBe(DEFAULT_MARGINS['w:left']);
    expect(pgMar.attributes['w:header']).toBe(DEFAULT_MARGINS['w:header']);
    expect(pgMar.attributes['w:footer']).toBe(DEFAULT_MARGINS['w:footer']);
    expect(pgMar.attributes['w:gutter']).toBe(DEFAULT_MARGINS['w:gutter']);
  });

  it('applies converter page styles when provided', () => {
    const converter = {
      pageStyles: {
        pageSize: { width: 5, height: 7 },
        pageMargins: { top: 1, bottom: 2 },
      },
    };

    const result = ensureSectionLayoutDefaults({ name: 'w:sectPr', elements: [] }, converter);

    const pgSz = getElement(result, 'w:pgSz');
    expect(pgSz.attributes['w:w']).toBe(String(5 * 1440));
    expect(pgSz.attributes['w:h']).toBe(String(7 * 1440));

    const pgMar = getElement(result, 'w:pgMar');
    expect(pgMar.attributes['w:top']).toBe(String(1440));
    expect(pgMar.attributes['w:bottom']).toBe(String(2880));
    expect(pgMar.attributes['w:left']).toBe(DEFAULT_MARGINS['w:left']);
    expect(pgMar.attributes['w:right']).toBe(DEFAULT_MARGINS['w:right']);
  });

  // Word allows per-section page geometry (e.g. a single landscape page). The
  // document-level pageStyles is only a fallback derived from the body section
  // on import, so a section that carries its own size/margins must keep them —
  // otherwise a landscape section collapses to the portrait document default.
  it("keeps the section's own page size and margins over document-level pageStyles", () => {
    const sectPr = {
      name: 'w:sectPr',
      elements: [
        // A4 landscape, in twips: width > height.
        { name: 'w:pgSz', attributes: { 'w:w': '16838', 'w:h': '11906', 'w:orient': 'landscape' } },
        { name: 'w:pgMar', attributes: { 'w:top': '1247', 'w:left': '1021' } },
      ],
    };
    const converter = {
      pageStyles: {
        // Portrait Letter — the (different) document-level fallback.
        pageSize: { width: 8.5, height: 11 },
        pageMargins: { top: 1, left: 1 },
      },
    };

    const result = ensureSectionLayoutDefaults(sectPr, converter);

    const pgSz = getElement(result, 'w:pgSz');
    expect(pgSz.attributes['w:w']).toBe('16838');
    expect(pgSz.attributes['w:h']).toBe('11906');
    expect(pgSz.attributes['w:orient']).toBe('landscape');

    const pgMar = getElement(result, 'w:pgMar');
    expect(pgMar.attributes['w:top']).toBe('1247');
    expect(pgMar.attributes['w:left']).toBe('1021');
  });

  // Word renders orientation from the w:w/w:h ratio, so a landscape flag paired
  // with portrait dimensions renders portrait. When we have to fall back to the
  // portrait default for a section that only declared its orientation, swap the
  // dimensions so the flag and the page actually agree.
  it('swaps fallback dimensions to landscape when the section is landscape but sized portrait', () => {
    const sectPr = {
      name: 'w:sectPr',
      // Only the orientation survived; width/height are missing and fall back to
      // the portrait default (12240 x 15840).
      elements: [{ name: 'w:pgSz', attributes: { 'w:orient': 'landscape' } }],
    };

    const result = ensureSectionLayoutDefaults(sectPr, {});

    const pgSz = getElement(result, 'w:pgSz');
    // Default portrait 12240 x 15840 → swapped to landscape 15840 x 12240.
    expect(pgSz.attributes['w:w']).toBe(DEFAULT_HEIGHT);
    expect(pgSz.attributes['w:h']).toBe(DEFAULT_WIDTH);
    expect(pgSz.attributes['w:orient']).toBe('landscape');
  });

  it('leaves already-consistent landscape dimensions untouched', () => {
    const sectPr = {
      name: 'w:sectPr',
      elements: [{ name: 'w:pgSz', attributes: { 'w:w': '15840', 'w:h': '12240', 'w:orient': 'landscape' } }],
    };

    const result = ensureSectionLayoutDefaults(sectPr, {});

    const pgSz = getElement(result, 'w:pgSz');
    expect(pgSz.attributes['w:w']).toBe('15840');
    expect(pgSz.attributes['w:h']).toBe('12240');
  });
});
