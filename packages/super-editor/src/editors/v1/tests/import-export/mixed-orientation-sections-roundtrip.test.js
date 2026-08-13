import { describe, it, expect } from 'vitest';
import { dirname, join } from 'path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'fs';
import { Editor } from '@core/Editor.js';
import DocxZipper from '@core/DocxZipper.js';
import { initTestEditor } from '../helpers/helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Parse every <w:pgSz.../> in the XML string into a list of attribute maps.
 * The fixture's pgSz elements are self-closing single-line tags, so a regex is
 * adequate and avoids pulling in a full XML parser for the assertion.
 */
const extractPgSzAttrs = (xml) => {
  const result = [];
  const tagRe = /<w:pgSz\s+([^>]*?)\/?>/g;
  let m;
  while ((m = tagRe.exec(xml)) !== null) {
    const attrs = {};
    const attrRe = /([\w:]+)="([^"]*)"/g;
    let am;
    while ((am = attrRe.exec(m[1])) !== null) {
      attrs[am[1]] = am[2];
    }
    result.push(attrs);
  }
  return result;
};

/**
 * Import the fixture, export it, and return the parsed <w:pgSz> lists.
 *
 * `mutateConverter` runs after import, before export — a seam to simulate the
 * collaboration / hydration path (see the second describe below), where
 * `converter.pageStyles` is a document-level portrait default rather than being
 * derived from the (landscape) body section on a fresh .docx import.
 */
async function roundTripPgSz(fixtureFileName, mutateConverter) {
  const docxPath = join(__dirname, '../data', fixtureFileName);
  const docxBuffer = await fs.readFile(docxPath);

  const inputZipper = new DocxZipper();
  const inputEntries = await inputZipper.getDocxData(docxBuffer, true);
  const inputDocXml = inputEntries.find((e) => e.name === 'word/document.xml').content;

  const [docx, media, mediaFiles, fonts] = await Editor.loadXmlData(docxBuffer, true);
  const { editor } = await initTestEditor({ content: docx, media, mediaFiles, fonts, isHeadless: true });

  if (mutateConverter) mutateConverter(editor.converter);

  const exportedBuffer = await editor.exportDocx({ isFinalDoc: false });
  const exportedZipper = new DocxZipper();
  const exportedEntries = await exportedZipper.getDocxData(exportedBuffer, true);
  const exportDocXml = exportedEntries.find((e) => e.name === 'word/document.xml').content;

  return {
    input: extractPgSzAttrs(inputDocXml),
    output: extractPgSzAttrs(exportDocXml),
  };
}

// A landscape page is defined by width > height. Word renders orientation from
// the w:w/w:h ratio, so a landscape section whose exported dimensions are
// portrait (taller than wide) renders portrait — the regression this guards.
const isLandscape = (pgSz) => Number(pgSz['w:w']) > Number(pgSz['w:h']);

describe('mixed-orientation sections — DOCX export preserves per-section page geometry', () => {
  const FIXTURE = 'mixed-orientation-sections.docx';

  it('the source fixture actually has a landscape section', async () => {
    const { input } = await roundTripPgSz(FIXTURE);
    const landscape = input.find((pgSz) => pgSz['w:orient'] === 'landscape');
    expect(landscape).toBeDefined();
    expect(isLandscape(landscape)).toBe(true);
  });

  it('keeps the landscape section landscape on export (dimensions match the orientation)', async () => {
    const { output } = await roundTripPgSz(FIXTURE);
    const landscape = output.find((pgSz) => pgSz['w:orient'] === 'landscape');
    expect(landscape).toBeDefined();
    // Before the fix, this section exported as the portrait default
    // (12240 x 15840) with a stray orient="landscape" flag → rendered portrait.
    expect(isLandscape(landscape)).toBe(true);
    expect(landscape['w:w']).toBe('16838');
    expect(landscape['w:h']).toBe('11906');
  });

  it('leaves the portrait section portrait on export', async () => {
    const { output } = await roundTripPgSz(FIXTURE);
    const portrait = output.find((pgSz) => pgSz['w:orient'] !== 'landscape');
    expect(portrait).toBeDefined();
    expect(isLandscape(portrait)).toBe(false);
    expect(portrait['w:w']).toBe('11906');
    expect(portrait['w:h']).toBe('16838');
  });

  // In the collaboration/hydration path the document isn't (re)imported from a
  // .docx on the client, so `converter.pageStyles` ends up as a document-level
  // portrait default instead of the landscape body section's real geometry.
  // That's the path where the bug actually bit: the exporter used to overwrite
  // the landscape body section's w:pgSz with that portrait document-level size,
  // leaving `orient="landscape"` on portrait dimensions → the page rendered
  // portrait. The body section's own geometry must win regardless.
  describe('when the document-level page style is a portrait default (collab/hydration path)', () => {
    const forcePortraitPageStyles = (converter) => {
      converter.pageStyles = {
        ...(converter.pageStyles || {}),
        // 8.5in x 11in — portrait US Letter, i.e. taller than wide.
        pageSize: { width: 8.5, height: 11 },
      };
    };

    it('still keeps the landscape section landscape on export', async () => {
      const { output } = await roundTripPgSz(FIXTURE, forcePortraitPageStyles);
      const landscape = output.find((pgSz) => pgSz['w:orient'] === 'landscape');
      expect(landscape).toBeDefined();
      expect(isLandscape(landscape)).toBe(true);
      expect(landscape['w:w']).toBe('16838');
      expect(landscape['w:h']).toBe('11906');
    });
  });
});
