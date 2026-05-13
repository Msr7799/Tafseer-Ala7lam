'use client';

import { Fragment, createElement, type ReactNode } from 'react';

type MarkdownRendererProps = {
  markdown: string;
};

type SectionKind = 'default' | 'sources' | 'symbols';

type MarkdownSection = {
  heading?: string;
  level: number;
  kind: SectionKind;
  blocks: ReactNode[];
};

const arabicDiacritics = /[\u064B-\u065F\u0670]/g;
const targetClosingLine = 'ذلك ماتبين لي واللّه أعلم .';

function compactArabic(text: string) {
  return text
    .replace(arabicDiacritics, '')
    .replace(/اللّه/g, 'الله')
    .replace(/أ/g, 'ا')
    .replace(/إ/g, 'ا')
    .replace(/آ/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\u0621-\u064A]+/g, '')
    .trim();
}

function isForbiddenClosingLine(text: string) {
  const compact = compactArabic(text);
  if (!compact) return false;

  return (
    compact.includes('نهايهالتحليل') ||
    compact.includes('السطرالاخير') ||
    compact.includes('ذلكماتبينليواللهاعلم') ||
    compact.includes('ذلكماتبينلياللهاعلم') ||
    compact === 'واللهاعلم' ||
    compact === 'اللهاعلم'
  );
}

function sanitizeMarkdown(markdown: string) {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const lines = normalized
    .split('\n')
    .filter((line) => line.trim() === targetClosingLine || !isForbiddenClosingLine(line));

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripTrailingColon(text: string) {
  return text.replace(/[：:：]\s*$/g, '').trim();
}

function isSourceLike(text: string) {
  return /(المصادر|مصادر|المصدر|المراجع|استشهاد|ابن سيرين|النابلسي|ابن شاهين|ابن قتيبة|الصحيحين|صحيح البخاري|صحيح مسلم)/.test(text);
}

function isSymbolHeading(text: string) {
  return /(تفسير\s+الرموز|الرموز\s+الرئيسية|رموز\s+الرؤيا|تحليل\s+الرموز)/.test(text);
}

function isSymbolLike(text: string) {
  return /(?:\*\*.+?\*\*\s*[：:]|إطلاق الرصاص|الرصاص|الجراحات|الإصابة|الطعن|الظهر|طلقتان|الطلقات|طلب النجدة|الملهوف|الاستغاثة|السهم|الرمي|السلاح)/.test(text);
}

function sectionKindFromHeading(text: string): SectionKind {
  if (isSymbolHeading(text)) return 'symbols';
  if (isSourceLike(text)) return 'sources';
  return 'default';
}

function renderInline(text: string): ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).filter(Boolean);

  return tokens.map((token, index) => {
    if (/^\*\*[^*]+\*\*$/.test(token)) {
      return <strong key={index}>{stripTrailingColon(token.slice(2, -2))}</strong>;
    }

    if (/^\*[^*]+\*$/.test(token)) {
      return <em key={index}>{token.slice(1, -1)}</em>;
    }

    if (/^`[^`]+`$/.test(token)) {
      return <code key={index}>{token.slice(1, -1)}</code>;
    }

    return <Fragment key={index}>{token}</Fragment>;
  });
}

function renderParagraph(lines: string[], key: number, sectionKind: SectionKind) {
  const joined = lines.join('\n');
  const closingLine = lines.length === 1 && lines[0].trim() === targetClosingLine;
  const className =
    closingLine
      ? 'answer-closing-line'
      : sectionKind === 'sources' || lines.some(isSourceLike)
        ? 'md-source-paragraph'
        : sectionKind === 'symbols' || lines.some(isSymbolLike)
          ? 'md-symbol-card'
          : undefined;

  return (
    <p key={key} className={className}>
      {lines.map((line, index) => (
        <Fragment key={index}>
          {renderInline(index === 0 && className === 'md-symbol-card' ? stripTrailingColon(line) : line)}
          {index < lines.length - 1 ? <br /> : null}
        </Fragment>
      ))}
      {joined.trim() ? null : null}
    </p>
  );
}

function renderHeading(level: number, content: string, key: number, kind: SectionKind) {
  const headingTag = `h${Math.min(6, level)}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

  return createElement(
    headingTag,
    {
      key,
      className: kind === 'sources' ? 'md-heading md-source-heading' : 'md-heading'
    },
    renderInline(stripTrailingColon(content))
  );
}

function renderSection(section: MarkdownSection, index: number) {
  if (!section.heading) {
    return <Fragment key={`section-${index}`}>{section.blocks}</Fragment>;
  }

  if (section.kind === 'symbols') {
    return (
      <details key={`section-${index}`} className="md-foldable-section md-symbol-section" open>
        <summary>
          <span className="md-summary-title">{renderInline(stripTrailingColon(section.heading))}</span>
          <span className="md-summary-hint">طي / فتح</span>
        </summary>
        <div className="md-section-body">{section.blocks}</div>
      </details>
    );
  }

  return (
    <Fragment key={`section-${index}`}>
      {renderHeading(section.level, section.heading, index * 100000, section.kind)}
      {section.blocks}
    </Fragment>
  );
}

export default function MarkdownRenderer({ markdown }: MarkdownRendererProps) {
  const normalized = sanitizeMarkdown(markdown);
  const lines = normalized.split('\n');
  const sections: MarkdownSection[] = [{ level: 0, kind: 'default', blocks: [] }];

  let paragraphLines: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let listSectionKind: SectionKind = 'default';
  let currentSectionKind: SectionKind = 'default';
  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];
  let keyCounter = 0;

  const currentSection = () => sections[sections.length - 1];

  const pushBlock = (node: ReactNode) => {
    currentSection().blocks.push(node);
  };

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    pushBlock(renderParagraph(paragraphLines, keyCounter++, currentSectionKind));
    paragraphLines = [];
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    const className =
      listSectionKind === 'sources' || listItems.some(isSourceLike)
        ? 'md-source-list'
        : listSectionKind === 'symbols' || listItems.some(isSymbolLike)
          ? 'md-symbol-list'
          : undefined;

    pushBlock(
      listOrdered ? (
        <ol key={keyCounter++} className={className}>
          {listItems.map((item, index) => (
            <li key={index}>{renderInline(stripTrailingColon(item))}</li>
          ))}
        </ol>
      ) : (
        <ul key={keyCounter++} className={className}>
          {listItems.map((item, index) => (
            <li key={index}>{renderInline(stripTrailingColon(item))}</li>
          ))}
        </ul>
      )
    );
    listItems = [];
    listSectionKind = 'default';
  };

  const flushCodeBlock = () => {
    if (!inCodeBlock) return;
    pushBlock(
      <pre key={keyCounter++} data-lang={codeLang || undefined}>
        <code>{codeLines.join('\n')}</code>
      </pre>
    );
    codeLines = [];
    inCodeBlock = false;
    codeLang = '';
  };

  const startSection = (level: number, content: string) => {
    flushParagraph();
    flushList();
    const cleanContent = stripTrailingColon(content.trim());
    currentSectionKind = sectionKindFromHeading(cleanContent);
    sections.push({ heading: cleanContent, level, kind: currentSectionKind, blocks: [] });
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        flushCodeBlock();
      } else {
        flushParagraph();
        flushList();
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(rawLine.replace(/\r$/, ''));
      continue;
    }

    if (line === '') {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      startSection(Math.min(6, headingMatch[1].length), headingMatch[2]);
      continue;
    }

    const boldHeadingMatch = line.match(/^\s*(?:[-*+]\s+)?\*\*(.+?)\*\*\s*[：:]?\s*$/);
    if (boldHeadingMatch && (isSymbolHeading(boldHeadingMatch[1]) || isSourceLike(boldHeadingMatch[1]))) {
      startSection(2, boldHeadingMatch[1]);
      continue;
    }

    const blockquoteMatch = line.match(/^>\s?(.*)$/);
    if (blockquoteMatch) {
      flushParagraph();
      flushList();
      const className = currentSection().kind === 'sources' ? 'md-source-quote' : undefined;
      pushBlock(
        <blockquote key={keyCounter++} className={className}>
          {renderInline(blockquoteMatch[1])}
        </blockquote>
      );
      continue;
    }

    const orderedMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    const unorderedMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    if (orderedMatch || unorderedMatch) {
      if (!listItems.length) {
        flushParagraph();
        listOrdered = Boolean(orderedMatch);
        listSectionKind = currentSectionKind;
      }
      listItems.push(stripTrailingColon((orderedMatch ?? unorderedMatch)?.[1] ?? line));
      continue;
    }

    paragraphLines.push(line);
  }

  flushCodeBlock();
  flushParagraph();
  flushList();

  return <div className="markdown-renderer">{sections.map(renderSection)}</div>;
}
