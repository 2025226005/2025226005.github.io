import Turndown from 'turndown';

const markdown = new Turndown({ emDelimiter: '*', bulletListMarker: '-' });
const escapeText = markdown.escape.bind(markdown);
// Literal award labels such as <Best Paper Award> are text, not HTML tags.
markdown.escape = text => escapeText(text).replace(/</g, '&lt;').replace(/>/g, '&gt;');
markdown.addRule('punctuation-emphasis', {
  filter: node => node.nodeName === 'EM' && /^[.,;:!?]+$/.test(node.textContent),
  replacement: (content, node) => `<em>${node.textContent}</em>`
});
export function htmlToCitation(html) {
  // Adjacent emphasis tags become one span, avoiding ambiguous '* *' delimiters.
  return markdown.turndown(html.replace(/<\/em>(\s*)<em>/g, '$1')).replace(/[\u200b\ufeff]/g, '');
}
