import * as vscode from "vscode";
import { FocusModeConfig, LineSpan } from "./types";

const VISIBLE_BUFFER_LINES = 80;
const FULL_DOC_LINE_THRESHOLD = 2000;
const GRADIENT_MID_BAND_MAX_DISTANCE = 6;

export class DecorationManager implements vscode.Disposable {
  private spotlightDecoration: vscode.TextEditorDecorationType | undefined;
  private nearDecoration: vscode.TextEditorDecorationType | undefined;
  private midDecoration: vscode.TextEditorDecorationType | undefined;
  private dimDecoration: vscode.TextEditorDecorationType | undefined;

  private activeConfigSignature = "";
  private readonly appliedStateByEditor = new Map<string, string>();

  constructor(config: FocusModeConfig) {
    this.rebuildDecorations(config);
  }

  public syncConfiguration(config: FocusModeConfig): void {
    const signature = getConfigSignature(config);
    if (signature !== this.activeConfigSignature) {
      this.rebuildDecorations(config);
    }
  }

  public applyDecorations(
    editor: vscode.TextEditor,
    focusSpan: LineSpan,
    config: FocusModeConfig
  ): void {
    this.syncConfiguration(config);

    if (!config.enabled) {
      this.clearDecorations(editor);
      return;
    }

    const doc = editor.document;
    if (doc.lineCount === 0) {
      this.clearDecorations(editor);
      return;
    }

    const maxLine = doc.lineCount - 1;
    const focusStart = Math.max(0, Math.min(focusSpan.startLine, maxLine));
    const focusEnd = Math.max(focusStart, Math.min(focusSpan.endLine, maxLine));
    const scanBounds = computeScanBounds(editor);

    const editorKey = getEditorKey(editor);
    const stateKey = JSON.stringify([
      this.activeConfigSignature,
      config.nearLines,
      focusStart,
      focusEnd,
      scanBounds.startLine,
      scanBounds.endLine,
      doc.lineCount,
      doc.lineAt(focusEnd).text.length,
      doc.lineAt(scanBounds.endLine).text.length,
    ]);

    if (this.appliedStateByEditor.get(editorKey) === stateKey) {
      return;
    }
    this.appliedStateByEditor.set(editorKey, stateKey);

    // Focused block receives no decoration unless highlightFocusedLine is enabled.
    if (this.spotlightDecoration) {
      const spotlightRange = new vscode.Range(
        focusStart,
        0,
        focusEnd,
        doc.lineAt(focusEnd).text.length
      );
      editor.setDecorations(this.spotlightDecoration, [spotlightRange]);
    }

    const nearRanges: vscode.Range[] = [];
    const midRanges: vscode.Range[] = [];
    const dimRanges: vscode.Range[] = [];

    const nearCount = config.nearLines;
    const useGradientMid = config.effectStyle === "gradient";
    const midOuterDistance = Math.max(
      nearCount,
      nearCount + GRADIENT_MID_BAND_MAX_DISTANCE
    );

    // Above focused block: dimDecoration -> (optional midDecoration) -> nearDecoration
    if (scanBounds.startLine < focusStart) {
      if (useGradientMid) {
        const farEnd = Math.min(focusStart - 1, focusStart - midOuterDistance - 1);
        if (scanBounds.startLine <= farEnd) {
          dimRanges.push(createLineSpanRange(doc, scanBounds.startLine, farEnd));
        }

        const midStart = Math.max(
          scanBounds.startLine,
          focusStart - midOuterDistance
        );
        const midEnd = Math.min(focusStart - 1, focusStart - nearCount - 1);
        if (midStart <= midEnd) {
          midRanges.push(createLineSpanRange(doc, midStart, midEnd));
        }
      } else {
        const dimEnd = focusStart - nearCount - 1;
        if (scanBounds.startLine <= dimEnd) {
          dimRanges.push(createLineSpanRange(doc, scanBounds.startLine, dimEnd));
        }
      }

      if (nearCount > 0) {
        const nearStart = Math.max(scanBounds.startLine, focusStart - nearCount);
        const nearEnd = focusStart - 1;
        if (nearStart <= nearEnd) {
          nearRanges.push(createLineSpanRange(doc, nearStart, nearEnd));
        }
      }
    }

    // Below focused block: nearDecoration -> (optional midDecoration) -> dimDecoration
    if (focusEnd < scanBounds.endLine) {
      if (nearCount > 0) {
        const nearStart = focusEnd + 1;
        const nearEnd = Math.min(scanBounds.endLine, focusEnd + nearCount);
        if (nearStart <= nearEnd) {
          nearRanges.push(createLineSpanRange(doc, nearStart, nearEnd));
        }
      }

      if (useGradientMid) {
        const midStart = focusEnd + nearCount + 1;
        const midEnd = Math.min(
          scanBounds.endLine,
          focusEnd + midOuterDistance
        );
        if (midStart <= midEnd) {
          midRanges.push(createLineSpanRange(doc, midStart, midEnd));
        }

        const farStart = focusEnd + midOuterDistance + 1;
        if (farStart <= scanBounds.endLine) {
          dimRanges.push(createLineSpanRange(doc, farStart, scanBounds.endLine));
        }
      } else {
        const dimStart = focusEnd + nearCount + 1;
        if (dimStart <= scanBounds.endLine) {
          dimRanges.push(createLineSpanRange(doc, dimStart, scanBounds.endLine));
        }
      }
    }

    if (this.nearDecoration) {
      editor.setDecorations(this.nearDecoration, nearRanges);
    }
    if (this.midDecoration) {
      editor.setDecorations(this.midDecoration, midRanges);
    }
    if (this.dimDecoration) {
      editor.setDecorations(this.dimDecoration, dimRanges);
    }
  }

  public clearDecorations(editor: vscode.TextEditor): void {
    this.appliedStateByEditor.delete(getEditorKey(editor));

    if (this.spotlightDecoration) {
      editor.setDecorations(this.spotlightDecoration, []);
    }
    if (this.nearDecoration) {
      editor.setDecorations(this.nearDecoration, []);
    }
    if (this.midDecoration) {
      editor.setDecorations(this.midDecoration, []);
    }
    if (this.dimDecoration) {
      editor.setDecorations(this.dimDecoration, []);
    }
  }

  public clearAllVisibleEditors(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.clearDecorations(editor);
    }
    this.appliedStateByEditor.clear();
  }

  public invalidateDocument(uri: vscode.Uri): void {
    const prefix = `${uri.toString()}::`;
    for (const key of this.appliedStateByEditor.keys()) {
      if (key.startsWith(prefix)) {
        this.appliedStateByEditor.delete(key);
      }
    }
  }

  public pruneHiddenEditors(visibleEditors: readonly vscode.TextEditor[]): void {
    const activeKeys = new Set(visibleEditors.map((e) => getEditorKey(e)));
    for (const key of this.appliedStateByEditor.keys()) {
      if (!activeKeys.has(key)) {
        this.appliedStateByEditor.delete(key);
      }
    }
  }

  public dispose(): void {
    this.appliedStateByEditor.clear();
    this.disposeDecorationTypes();
  }

  private rebuildDecorations(config: FocusModeConfig): void {
    this.clearAllVisibleEditors();
    this.disposeDecorationTypes();

    this.activeConfigSignature = getConfigSignature(config);

    if (config.highlightFocusedLine) {
      this.spotlightDecoration = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: config.focusedLineBackground,
        borderWidth: "0 0 0 3px",
        borderStyle: "solid",
        borderColor: config.focusedLineBorderColor,
      });
    }

    const useOpacity = config.effectStyle !== "blurOnly";
    const useBlur = config.effectStyle !== "dimOnly";

    const nearOpacity = useOpacity ? config.nearOpacity : undefined;
    const nearBlur = useBlur ? config.blurAmountPx * 0.4 : undefined;
    this.nearDecoration = createBandDecorationType(nearOpacity, nearBlur);

    if (config.effectStyle === "gradient") {
      const midOpacity = (config.nearOpacity + config.dimOpacity) / 2;
      const midBlur = config.blurAmountPx * 0.7;
      this.midDecoration = createBandDecorationType(midOpacity, midBlur);
    }

    const dimOpacity = useOpacity ? config.dimOpacity : undefined;
    const dimBlur = useBlur ? config.blurAmountPx : undefined;
    this.dimDecoration = createBandDecorationType(dimOpacity, dimBlur);
  }

  private disposeDecorationTypes(): void {
    this.spotlightDecoration?.dispose();
    this.nearDecoration?.dispose();
    this.midDecoration?.dispose();
    this.dimDecoration?.dispose();

    this.spotlightDecoration = undefined;
    this.nearDecoration = undefined;
    this.midDecoration = undefined;
    this.dimDecoration = undefined;
  }
}

function getEditorKey(editor: vscode.TextEditor): string {
  return `${editor.document.uri.toString()}::${editor.viewColumn ?? "none"}`;
}

function createBandDecorationType(
  opacity: number | undefined,
  blurPx: number | undefined
): vscode.TextEditorDecorationType {
  const options: vscode.DecorationRenderOptions = {};

  if (opacity !== undefined) {
    options.opacity = opacity.toFixed(2);
  }

  if (blurPx !== undefined && blurPx > 0) {
    // Inject CSS blur filter through textDecoration because VS Code's DecorationRenderOptions
    // does not expose a dedicated `filter` field.
    options.textDecoration = `none; filter: blur(${blurPx.toFixed(2)}px);`;
  }

  return vscode.window.createTextEditorDecorationType(options);
}

function computeScanBounds(editor: vscode.TextEditor): LineSpan {
  const doc = editor.document;
  const maxLine = doc.lineCount - 1;

  if (
    doc.lineCount <= FULL_DOC_LINE_THRESHOLD ||
    editor.visibleRanges.length === 0
  ) {
    return { startLine: 0, endLine: maxLine };
  }

  let minVisible = maxLine;
  let maxVisible = 0;

  for (const visibleRange of editor.visibleRanges) {
    minVisible = Math.min(minVisible, visibleRange.start.line);
    maxVisible = Math.max(maxVisible, visibleRange.end.line);
  }

  return {
    startLine: Math.max(0, minVisible - VISIBLE_BUFFER_LINES),
    endLine: Math.min(maxLine, maxVisible + VISIBLE_BUFFER_LINES),
  };
}

function createLineSpanRange(
  document: vscode.TextDocument,
  startLine: number,
  endLine: number
): vscode.Range {
  const clampedStart = Math.max(0, Math.min(startLine, document.lineCount - 1));
  const clampedEnd = Math.max(
    clampedStart,
    Math.min(endLine, document.lineCount - 1)
  );
  const endCharacter = document.lineAt(clampedEnd).text.length;
  return new vscode.Range(clampedStart, 0, clampedEnd, endCharacter);
}

function getConfigSignature(config: FocusModeConfig): string {
  return JSON.stringify([
    config.effectStyle,
    config.nearOpacity,
    config.dimOpacity,
    config.blurAmountPx,
    config.highlightFocusedLine,
    config.focusedLineBackground,
    config.focusedLineBorderColor,
  ]);
}
