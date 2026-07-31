import { describe, expect, it } from 'vitest';
import { readChoiceListData } from './sdt-info-builder.js';

/**
 * `readChoiceListData` parses a comboBox/dropDownList `sdtPr` into its list
 * items. The interesting case is `w:displayText`: ECMA-376 says a list item
 * that OMITS `w:displayText` displays its `w:value`, but a `w:displayText`
 * that is PRESENT (even as an empty string) is used verbatim. Those two must
 * not be collapsed.
 */
describe('readChoiceListData', () => {
  it('falls back to w:value when w:displayText is omitted', () => {
    const sdtPr = {
      name: 'w:sdtPr',
      elements: [
        {
          name: 'w:dropDownList',
          elements: [{ name: 'w:listItem', attributes: { 'w:value': 'Yes' } }],
        },
      ],
    };

    const { items } = readChoiceListData(sdtPr, 'dropDownList');

    expect(items).toEqual([{ displayText: 'Yes', value: 'Yes' }]);
  });

  it('uses a present-but-empty w:displayText verbatim', () => {
    const sdtPr = {
      name: 'w:sdtPr',
      elements: [
        {
          name: 'w:dropDownList',
          elements: [{ name: 'w:listItem', attributes: { 'w:displayText': '', 'w:value': 'Yes' } }],
        },
      ],
    };

    const { items } = readChoiceListData(sdtPr, 'dropDownList');

    expect(items).toEqual([{ displayText: '', value: 'Yes' }]);
  });

  it('reads a non-empty w:displayText and the selected value', () => {
    const sdtPr = {
      name: 'w:sdtPr',
      elements: [
        {
          name: 'w:comboBox',
          attributes: { 'w:lastValue': 'no' },
          elements: [
            { name: 'w:listItem', attributes: { 'w:displayText': 'Yes', 'w:value': 'yes' } },
            { name: 'w:listItem', attributes: { 'w:displayText': 'No', 'w:value': 'no' } },
          ],
        },
      ],
    };

    const { items, selectedValue } = readChoiceListData(sdtPr, 'comboBox');

    expect(items).toEqual([
      { displayText: 'Yes', value: 'yes' },
      { displayText: 'No', value: 'no' },
    ]);
    expect(selectedValue).toBe('no');
  });
});
