import { Plugin, PluginKey } from 'prosemirror-state';
import { splitAnchoredMetadataAt } from './split-anchored-metadata.js';

export const STRUCTURED_CONTENT_SPLIT_KEY = new PluginKey('structuredContentSplit');

/**
 * Enter inside an anchored-metadata highlight must still start a new paragraph
 * (or list item). The highlight is an `isolating` structuredContent SDT, so the
 * default Enter binding's `splitBlock` refuses to split and the keypress is
 * otherwise a no-op. Intercept a plain Enter and break the block through the
 * anchor; fall through (return false) for modified Enter and everywhere outside
 * an anchor so normal Enter behavior is unchanged.
 */
export function createStructuredContentSplitPlugin() {
  return new Plugin({
    key: STRUCTURED_CONTENT_SPLIT_KEY,
    props: {
      handleKeyDown(view, event) {
        if (event.key !== 'Enter') return false;
        if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
        return splitAnchoredMetadataAt(view.state, view.dispatch);
      },
    },
  });
}
