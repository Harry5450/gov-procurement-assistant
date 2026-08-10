export type TemplateXmlKind = 'word' | 'odt';

export interface TemplateAnchorSpec {
  text: string;
  selectable?: boolean;
  checkboxPrefix?: boolean;
}

export interface TemplateMutationResult {
  xml: string;
  changed: boolean;
  resolved: boolean;
  matches: number;
  reason?: 'empty-value' | 'missing' | 'ambiguous' | 'unchanged';
}

interface TemplateBlock {
  xml: string;
  text: string;
  index: number;
  tag?: string;
}

const CHECKBOX = /[□☐■☒]/;
const UNCHECKED_BOX = /[□☐]/;
const CHECKED_BOX = /[■☒]/;
const CHECKBOX_GLYPHS = ['', '□', '☐', '■', '☒'];

function decodeXmlText(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeXmlText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wordParagraphText(paragraphXml: string) {
  return [...paragraphXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXmlText(match[1]))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function odtBlockText(blockXml: string) {
  return decodeXmlText(
    blockXml
      .replace(/<text:s\b[^>]*text:c="(\d+)"[^>]*\/>/g, (_match, count) => ' '.repeat(Number(count)))
      .replace(/<text:s\b[^>]*\/>/g, ' ')
      .replace(/<text:tab\b[^>]*\/>/g, '\t')
      .replace(/<text:line-break\b[^>]*\/>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  ).replace(/\s+/g, ' ').trim();
}

function collectBlocks(xml: string, kind: TemplateXmlKind): TemplateBlock[] {
  if (kind === 'word') {
    return [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((match) => ({
      xml: match[0],
      text: wordParagraphText(match[0]),
      index: match.index,
    }));
  }

  return [...xml.matchAll(/<text:(p|h)\b[\s\S]*?<\/text:\1>/g)].map((match) => ({
    xml: match[0],
    text: odtBlockText(match[0]),
    index: match.index,
    tag: match[1],
  }));
}

function startsWithCheckboxOption(text: string, optionText: string) {
  const compact = text.replace(/\s+/g, '');
  return CHECKBOX_GLYPHS.some((glyph) => compact.startsWith(`${glyph}${optionText}`));
}

function resolveUniqueBlock(xml: string, kind: TemplateXmlKind, anchor: TemplateAnchorSpec) {
  const matches = collectBlocks(xml, kind).filter((block) => {
    if (!block.text.includes(anchor.text)) return false;
    if (anchor.checkboxPrefix) return startsWithCheckboxOption(block.text, anchor.text);
    if (anchor.selectable) return CHECKBOX.test(block.xml);
    return true;
  });

  if (matches.length !== 1) {
    return {
      block: undefined,
      matches: matches.length,
      reason: matches.length === 0 ? 'missing' as const : 'ambiguous' as const,
    };
  }

  return { block: matches[0], matches: 1, reason: undefined };
}

function mutateUniqueBlock(
  xml: string,
  kind: TemplateXmlKind,
  anchor: TemplateAnchorSpec,
  mutate: (block: TemplateBlock) => string,
): TemplateMutationResult {
  const resolved = resolveUniqueBlock(xml, kind, anchor);
  if (!resolved.block) {
    return {
      xml,
      changed: false,
      resolved: false,
      matches: resolved.matches,
      reason: resolved.reason,
    };
  }

  const nextBlock = mutate(resolved.block);
  if (nextBlock === resolved.block.xml) {
    return {
      xml,
      changed: false,
      resolved: true,
      matches: 1,
      reason: 'unchanged',
    };
  }

  const start = resolved.block.index;
  const end = start + resolved.block.xml.length;
  return {
    xml: `${xml.slice(0, start)}${nextBlock}${xml.slice(end)}`,
    changed: true,
    resolved: true,
    matches: 1,
  };
}

function emptyMutation(xml: string): TemplateMutationResult {
  return {
    xml,
    changed: false,
    resolved: false,
    matches: 0,
    reason: 'empty-value',
  };
}

export function appendInlineAtAnchor(
  xml: string,
  kind: TemplateXmlKind,
  anchor: TemplateAnchorSpec,
  value: string,
): TemplateMutationResult {
  if (!value.trim()) return emptyMutation(xml);

  return mutateUniqueBlock(xml, kind, anchor, (block) => {
    if (kind === 'word') {
      return block.xml.replace(
        /<\/w:p>$/,
        `<w:r><w:t xml:space="preserve">${escapeXmlText(value)}</w:t></w:r></w:p>`,
      );
    }

    if (!block.tag) return block.xml;
    return block.xml.replace(
      new RegExp(`</text:${block.tag}>$`),
      `<text:span>${escapeXmlText(value)}</text:span></text:${block.tag}>`,
    );
  });
}

export function insertParagraphAfterAnchor(
  xml: string,
  kind: TemplateXmlKind,
  anchor: TemplateAnchorSpec,
  value: string,
): TemplateMutationResult {
  if (!value.trim()) return emptyMutation(xml);

  return mutateUniqueBlock(xml, kind, anchor, (block) => {
    if (kind === 'word') {
      const pPr = block.xml.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
      const inserted = `<w:p>${pPr}<w:r><w:t xml:space="preserve">${escapeXmlText(value)}</w:t></w:r></w:p>`;
      return `${block.xml}${inserted}`;
    }

    return `${block.xml}<text:p>${escapeXmlText(value)}</text:p>`;
  });
}

export function selectCheckboxOptionAtAnchor(
  xml: string,
  kind: TemplateXmlKind,
  optionText: string,
  options: { checkboxPrefix?: boolean } = {},
): TemplateMutationResult {
  return mutateUniqueBlock(
    xml,
    kind,
    {
      text: optionText,
      selectable: true,
      checkboxPrefix: options.checkboxPrefix,
    },
    (block) => {
      if (CHECKED_BOX.test(block.xml)) return block.xml;
      if (!UNCHECKED_BOX.test(block.xml)) return block.xml;
      return block.xml.replace(UNCHECKED_BOX, '■');
    },
  );
}

export function replaceVisibleLiteralAtAnchor(
  xml: string,
  kind: TemplateXmlKind,
  anchor: TemplateAnchorSpec,
  literal: string,
  replacement: string,
): TemplateMutationResult {
  if (!replacement.trim()) return emptyMutation(xml);

  return mutateUniqueBlock(xml, kind, anchor, (block) => {
    const escapedLiteral = escapeXmlText(literal);
    if (block.xml.includes(escapedLiteral)) {
      return block.xml.replace(escapedLiteral, escapeXmlText(replacement));
    }
    if (block.xml.includes(literal)) {
      return block.xml.replace(literal, escapeXmlText(replacement));
    }
    return block.xml;
  });
}

export function replaceBlockTextAtAnchor(
  xml: string,
  kind: TemplateXmlKind,
  anchor: TemplateAnchorSpec,
  value: string,
): TemplateMutationResult {
  if (!value.trim()) return emptyMutation(xml);

  return mutateUniqueBlock(xml, kind, anchor, (block) => {
    if (kind === 'word') {
      const pPr = block.xml.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
      return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${escapeXmlText(value)}</w:t></w:r></w:p>`;
    }

    if (!block.tag) return block.xml;
    const open = block.xml.match(new RegExp(`^<text:${block.tag}\\b[^>]*>`))?.[0];
    if (!open) return block.xml;
    return `${open}${escapeXmlText(value)}</text:${block.tag}>`;
  });
}
