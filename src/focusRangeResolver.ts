import * as vscode from "vscode";
import { FocusModeConfig, LineSpan } from "./types";

const CLOSING_LINE_PATTERN = /^(\}|\]|\)|<\/|end\b)/;
const CONTINUATION_CLOSING_PATTERN = /^(\}|\]|\)|<\/|end\b|else\b|elif\b|catch\b|finally\b)/;

/**
 * Resolves the focused line range [startLine, endLine] around the anchor
 * according to focusScope, maxBlockLines, and contextLines.
 */
export function resolveFocusedLineSpan(
  document: vscode.TextDocument,
  anchorStartLine: number,
  anchorEndLine: number,
  config: FocusModeConfig
): LineSpan {
  if (document.lineCount === 0) {
    return { startLine: 0, endLine: 0 };
  }

  const maxLine = document.lineCount - 1;
  const start = clampLine(Math.min(anchorStartLine, anchorEndLine), maxLine);
  const end = clampLine(Math.max(anchorStartLine, anchorEndLine), maxLine);

  // If the user explicitly selected multiple lines, preserve the full selection.
  if (end > start) {
    return { startLine: start, endLine: end };
  }

  if (config.focusScope === "line") {
    return expandWithContext(start, start, config.contextLines, maxLine);
  }

  if (config.focusScope === "paragraph") {
    let span = resolveParagraphSpan(document, start);
    if (span.endLine - span.startLine + 1 > config.maxBlockLines) {
      const half = Math.max(1, Math.floor((config.maxBlockLines - 1) / 2));
      span = {
        startLine: clampLine(start - half, maxLine),
        endLine: clampLine(start + half, maxLine),
      };
    }
    if (span.startLine === span.endLine && config.contextLines > 0) {
      return expandWithContext(
        span.startLine,
        span.endLine,
        config.contextLines,
        maxLine
      );
    }
    return span;
  }

  // focusScope === "block"
  let span = resolveIndentationBlockSpan(document, start);

  // Cap overly large blocks by falling back to paragraph or local context window.
  if (span.endLine - span.startLine + 1 > config.maxBlockLines) {
    const paragraph = resolveParagraphSpan(document, start);
    if (paragraph.endLine - paragraph.startLine + 1 <= config.maxBlockLines) {
      span = paragraph;
    } else {
      const padding = Math.max(1, config.contextLines);
      span = {
        startLine: clampLine(start - padding, maxLine),
        endLine: clampLine(start + padding, maxLine),
      };
    }
  }

  // Guarantee tight surrounding context when a block resolves to a single line.
  if (span.startLine === span.endLine && config.contextLines > 0) {
    span = expandWithContext(
      span.startLine,
      span.endLine,
      config.contextLines,
      maxLine
    );
  }

  return span;
}

function resolveParagraphSpan(
  document: vscode.TextDocument,
  anchorLine: number
): LineSpan {
  if (document.lineAt(anchorLine).isEmptyOrWhitespace) {
    return { startLine: anchorLine, endLine: anchorLine };
  }

  let start = anchorLine;
  while (start > 0 && !document.lineAt(start - 1).isEmptyOrWhitespace) {
    start--;
  }

  let end = anchorLine;
  const maxLine = document.lineCount - 1;
  while (end < maxLine && !document.lineAt(end + 1).isEmptyOrWhitespace) {
    end++;
  }

  return { startLine: start, endLine: end };
}

function resolveIndentationBlockSpan(
  document: vscode.TextDocument,
  anchorLine: number
): LineSpan {
  const maxLine = document.lineCount - 1;
  const anchorTextLine = document.lineAt(anchorLine);

  if (anchorTextLine.isEmptyOrWhitespace) {
    return { startLine: anchorLine, endLine: anchorLine };
  }

  const anchorIndent = getIndentWidth(anchorTextLine.text);
  const trimmedAnchor = anchorTextLine.text.trim();

  // Case 1: Anchor is a block opener (ends with '{' or ':', or next non-empty line is indented deeper).
  if (isBlockOpener(document, anchorLine, anchorIndent, trimmedAnchor)) {
    return expandDownwardFromOpener(document, anchorLine, anchorIndent, maxLine);
  }

  // Case 2: Anchor is a closing delimiter ('}', '};', ')', ']', 'end').
  if (CLOSING_LINE_PATTERN.test(trimmedAnchor)) {
    return expandUpwardFromCloser(document, anchorLine, anchorIndent);
  }

  // Case 3: Top-level line (indent === 0) that is neither opener nor closer -> paragraph only.
  if (anchorIndent === 0) {
    return resolveParagraphSpan(document, anchorLine);
  }

  // Case 4: Inside an indented block (baseIndent > 0).
  const baseIndent = anchorIndent;
  const stopAtBlankLines = baseIndent <= 4;
  let start = anchorLine;
  let end = anchorLine;

  // Expand upward through lines with indent >= baseIndent.
  let candidate = start - 1;
  while (candidate >= 0) {
    const line = document.lineAt(candidate);
    if (line.isEmptyOrWhitespace) {
      if (stopAtBlankLines) {
        break;
      }
      candidate--;
      continue;
    }

    const indent = getIndentWidth(line.text);
    const trimmed = line.text.trim();
    if (indent >= baseIndent) {
      // Avoid merging into a previous sibling block that ended at baseIndent.
      if (indent === baseIndent && CLOSING_LINE_PATTERN.test(trimmed)) {
        break;
      }
      start = candidate;
      candidate--;
    } else {
      break;
    }
  }

  // Expand downward through lines with indent >= baseIndent.
  candidate = end + 1;
  while (candidate <= maxLine) {
    const line = document.lineAt(candidate);
    if (line.isEmptyOrWhitespace) {
      if (stopAtBlankLines) {
        break;
      }
      candidate++;
      continue;
    }

    const indent = getIndentWidth(line.text);
    if (indent >= baseIndent) {
      end = candidate;
      candidate++;
    } else {
      break;
    }
  }

  // Include enclosing header line above (plus header above Allman '{').
  start = includeHeaderLineAbove(document, start, baseIndent);

  // Include closing bracket/delimiter line below if adjacent.
  if (end < maxLine) {
    const nextLine = document.lineAt(end + 1);
    if (!nextLine.isEmptyOrWhitespace && getIndentWidth(nextLine.text) < baseIndent) {
      const trimmed = nextLine.text.trim();
      if (CONTINUATION_CLOSING_PATTERN.test(trimmed)) {
        end++;
      }
    }
  }

  return { startLine: start, endLine: end };
}

function isBlockOpener(
  document: vscode.TextDocument,
  lineIdx: number,
  lineIndent: number,
  trimmedText: string
): boolean {
  if (trimmedText.endsWith("{") || trimmedText.endsWith(":")) {
    return true;
  }

  const nextNonEmpty = findNextNonEmptyLine(document, lineIdx + 1);
  if (nextNonEmpty !== undefined) {
    const nextIndent = getIndentWidth(document.lineAt(nextNonEmpty).text);
    if (nextIndent > lineIndent) {
      return true;
    }
  }

  return false;
}

function expandDownwardFromOpener(
  document: vscode.TextDocument,
  openerLine: number,
  openerIndent: number,
  maxLine: number
): LineSpan {
  let start = openerLine;
  // If opener line is an Allman '{', include the signature/header line immediately above it.
  if (document.lineAt(openerLine).text.trim() === "{" && openerLine > 0) {
    const prevLine = document.lineAt(openerLine - 1);
    if (
      !prevLine.isEmptyOrWhitespace &&
      getIndentWidth(prevLine.text) === openerIndent
    ) {
      start = openerLine - 1;
    }
  }

  let end = openerLine;
  let candidate = openerLine + 1;
  while (candidate <= maxLine) {
    const line = document.lineAt(candidate);
    if (line.isEmptyOrWhitespace) {
      candidate++;
      continue;
    }

    const indent = getIndentWidth(line.text);
    if (indent > openerIndent) {
      end = candidate;
      candidate++;
      continue;
    }

    // Include matching closing delimiter at the opener's indentation level.
    if (
      indent === openerIndent &&
      CONTINUATION_CLOSING_PATTERN.test(line.text.trim())
    ) {
      end = candidate;
    }
    break;
  }

  return { startLine: start, endLine: end };
}

function expandUpwardFromCloser(
  document: vscode.TextDocument,
  closerLine: number,
  closerIndent: number
): LineSpan {
  let start = closerLine;
  let candidate = closerLine - 1;

  while (candidate >= 0) {
    const line = document.lineAt(candidate);
    if (line.isEmptyOrWhitespace) {
      candidate--;
      continue;
    }

    const indent = getIndentWidth(line.text);
    if (indent > closerIndent) {
      start = candidate;
      candidate--;
      continue;
    }

    if (indent === closerIndent) {
      start = candidate;
      if (line.text.trim() === "{" && candidate > 0) {
        const headerCandidate = document.lineAt(candidate - 1);
        if (
          !headerCandidate.isEmptyOrWhitespace &&
          getIndentWidth(headerCandidate.text) === closerIndent
        ) {
          start = candidate - 1;
        }
      }
    }
    break;
  }

  return { startLine: start, endLine: closerLine };
}

function includeHeaderLineAbove(
  document: vscode.TextDocument,
  startLine: number,
  baseIndent: number
): number {
  if (startLine <= 0) {
    return startLine;
  }

  const prevLine = document.lineAt(startLine - 1);
  if (prevLine.isEmptyOrWhitespace) {
    return startLine;
  }

  const prevIndent = getIndentWidth(prevLine.text);
  if (prevIndent >= baseIndent) {
    return startLine;
  }

  let nextStart = startLine - 1;
  if (prevLine.text.trim() === "{" && nextStart > 0) {
    const aboveBrace = document.lineAt(nextStart - 1);
    if (
      !aboveBrace.isEmptyOrWhitespace &&
      getIndentWidth(aboveBrace.text) === prevIndent
    ) {
      nextStart--;
    }
  }
  return nextStart;
}

function findNextNonEmptyLine(
  document: vscode.TextDocument,
  fromLine: number
): number | undefined {
  for (let i = fromLine; i < document.lineCount; i++) {
    if (!document.lineAt(i).isEmptyOrWhitespace) {
      return i;
    }
  }
  return undefined;
}

function getIndentWidth(text: string): number {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === " ") {
      width += 1;
    } else if (ch === "\t") {
      width += 4;
    } else {
      break;
    }
  }
  return width;
}

function expandWithContext(
  startLine: number,
  endLine: number,
  contextLines: number,
  maxLine: number
): LineSpan {
  return {
    startLine: clampLine(startLine - contextLines, maxLine),
    endLine: clampLine(endLine + contextLines, maxLine),
  };
}

function clampLine(line: number, maxLine: number): number {
  return Math.max(0, Math.min(line, maxLine));
}
