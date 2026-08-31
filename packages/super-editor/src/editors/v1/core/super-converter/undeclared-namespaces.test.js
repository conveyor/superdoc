/**
 * An undeclared namespace prefix makes word/document.xml malformed: strict
 * parsers reject the file ("unbound prefix"), lenient ones degrade quietly.
 * Word reaches us with generated prefixes (ns5/ns6/ns8) that the source
 * declared locally, so they are absent from DEFAULT_DOCX_DEFS on export.
 */

import { describe, it, expect } from 'vitest';
import { declareMissingNamespaces } from './exporter.js';
import { DEFAULT_DOCX_DEFS } from './exporter-docx-defs.js';

const A14 = 'http://schemas.microsoft.com/office/drawing/2010/main';

/** A picture whose DPI hint arrives under a generated prefix, as Word writes it. */
const drawingWithGeneratedPrefix = () => ({
  name: 'w:document',
  elements: [
    {
      name: 'w:body',
      elements: [
        {
          name: 'w:p',
          elements: [
            {
              name: 'w:drawing',
              elements: [
                {
                  name: 'pic:blipFill',
                  elements: [
                    {
                      name: 'a:blip',
                      attributes: { 'r:embed': 'rId12' },
                      elements: [
                        {
                          name: 'a:extLst',
                          elements: [
                            {
                              name: 'a:ext',
                              attributes: { uri: '{28A0092B-C50C-407E-A947-70E740481C1C}' },
                              elements: [{ name: 'ns8:useLocalDpi', attributes: { val: '0' } }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

describe('declareMissingNamespaces', () => {
  it('binds a generated prefix to the namespace its element belongs to', () => {
    const attributes = { ...DEFAULT_DOCX_DEFS };
    expect(attributes['xmlns:ns8']).toBeUndefined();

    declareMissingNamespaces(drawingWithGeneratedPrefix(), attributes);

    // Resolved by local name, so the declaration is correct and not a placeholder.
    expect(attributes['xmlns:ns8']).toBe(A14);
  });

  it('leaves prefixes that DEFAULT_DOCX_DEFS already binds untouched', () => {
    const attributes = { ...DEFAULT_DOCX_DEFS };
    const before = { ...attributes };

    declareMissingNamespaces(drawingWithGeneratedPrefix(), attributes);

    for (const key of Object.keys(before)) {
      expect(attributes[key]).toBe(before[key]);
    }
  });

  it('declares a prefix used only by an attribute', () => {
    const attributes = { ...DEFAULT_DOCX_DEFS };
    const node = {
      name: 'w:document',
      elements: [{ name: 'w:body', elements: [{ name: 'w:p', attributes: { 'ns9:custom': '1' } }] }],
    };

    declareMissingNamespaces(node, attributes);

    expect(attributes['xmlns:ns9']).toBeDefined();
  });

  it('falls back to a unique placeholder for an unrecognised element', () => {
    const attributes = { ...DEFAULT_DOCX_DEFS };
    const node = {
      name: 'w:document',
      elements: [{ name: 'w:body', elements: [{ name: 'ns7:somethingNew' }] }],
    };

    declareMissingNamespaces(node, attributes);

    // Unknown, but declared — the file parses rather than failing outright.
    expect(attributes['xmlns:ns7']).toBe('http://schemas.superdoc.dev/unknown/ns7');
  });

  it('never declares xmlns or the reserved xml prefix', () => {
    const attributes = { ...DEFAULT_DOCX_DEFS };
    const node = {
      name: 'w:document',
      elements: [{ name: 'w:body', elements: [{ name: 'w:t', attributes: { 'xml:space': 'preserve' } }] }],
    };

    declareMissingNamespaces(node, attributes);

    expect(attributes['xmlns:xml']).toBeUndefined();
    expect(attributes['xmlns:xmlns']).toBeUndefined();
  });

  it('is idempotent', () => {
    const attributes = { ...DEFAULT_DOCX_DEFS };
    const node = drawingWithGeneratedPrefix();

    declareMissingNamespaces(node, attributes);
    const once = { ...attributes };
    declareMissingNamespaces(node, attributes);

    expect(attributes).toEqual(once);
  });

  it('handles a document with no elements', () => {
    const attributes = { ...DEFAULT_DOCX_DEFS };
    expect(() => declareMissingNamespaces({ name: 'w:document' }, attributes)).not.toThrow();
  });
});
