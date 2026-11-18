import * as vscode from "vscode";
import { getFocusModeConfig, updateConfigValue } from "./config";
import { DecorationManager } from "./decorationManager";
import { resolveFocusedLineSpan } from "./focusRangeResolver";
import {
  EffectStyle,
  FocusAnchor,
  FocusModeConfig,
  FocusScope,
  TriggerMode,
} from "./types";

const IGNORED_SCHEMES = new Set([
  "output",
  "debug",
  "comment",
  "vscode-terminal",
  "log",
]);

export function activate(context: vscode.ExtensionContext): void {
  let config = getFocusModeConfig();
  const decorationManager = new DecorationManager(config);
  const editorAnchors = new Map<string, FocusAnchor>();

  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    101
  );
  statusBarItem.command = "hoverBlockDimmer.quickMenu";

  const updateStatusBar = (): void => {
    if (!config.enabled) {
      statusBarItem.text = "$(eye-closed) Focus: Off";
      statusBarItem.tooltip =
        "HoverBlock Dimmer is disabled. Click to open settings or press Ctrl+Alt+F to enable.";
      statusBarItem.show();
      return;
    }

    const scopeLabel = formatScopeLabel(config);
    const triggerLabel = formatTriggerLabel(config.triggerMode);
    statusBarItem.text = `$(eye) Focus: ${scopeLabel} (${triggerLabel})`;
    statusBarItem.tooltip = [
      `HoverBlock Dimmer Active`,
      `Effect: ${config.effectStyle} (near ${config.nearOpacity} / ${config.nearLines}L, dim ${config.dimOpacity}, blur ${config.blurAmountPx}px)`,
      `Scope: ${scopeLabel} | Trigger: ${triggerLabel}`,
      `Click to configure | Shortcut: Ctrl+Alt+F`,
    ].join("\n");
    statusBarItem.show();
  };

  const getEditorKey = (editor: vscode.TextEditor): string => {
    return `${editor.document.uri.toString()}::${editor.viewColumn ?? "none"}`;
  };

  const getSelectionAnchor = (editor: vscode.TextEditor): FocusAnchor => {
    const sel = editor.selection;
    return {
      startLine: sel.start.line,
      endLine: sel.end.line,
      source: "cursor",
    };
  };

  const refreshEditor = (editor: vscode.TextEditor | undefined): void => {
    if (!editor || IGNORED_SCHEMES.has(editor.document.uri.scheme)) {
      return;
    }

    if (!config.enabled) {
      decorationManager.clearDecorations(editor);
      return;
    }

    const key = getEditorKey(editor);
    let anchor = editorAnchors.get(key);

    if (config.triggerMode === "cursorOnly") {
      anchor = getSelectionAnchor(editor);
      editorAnchors.set(key, anchor);
    } else if (!anchor) {
      anchor = getSelectionAnchor(editor);
      editorAnchors.set(key, anchor);
    }

    const focusSpan = resolveFocusedLineSpan(
      editor.document,
      anchor.startLine,
      anchor.endLine,
      config
    );
    decorationManager.applyDecorations(editor, focusSpan, config);
  };

  const refreshAllVisibleEditors = (): void => {
    updateStatusBar();
    for (const editor of vscode.window.visibleTextEditors) {
      refreshEditor(editor);
    }
  };

  // Track mouse hover across lines silently without displaying a tooltip.
  const hoverProviderDisposable = vscode.languages.registerHoverProvider(
    { scheme: "*" },
    {
      provideHover(document, position) {
        if (
          !config.enabled ||
          config.triggerMode === "cursorOnly" ||
          IGNORED_SCHEMES.has(document.uri.scheme)
        ) {
          return undefined;
        }

        const docUri = document.uri.toString();
        for (const editor of vscode.window.visibleTextEditors) {
          if (editor.document.uri.toString() === docUri) {
            editorAnchors.set(getEditorKey(editor), {
              startLine: position.line,
              endLine: position.line,
              source: "hover",
            });
            refreshEditor(editor);
          }
        }

        return undefined;
      },
    }
  );

  context.subscriptions.push(
    decorationManager,
    statusBarItem,
    hoverProviderDisposable,

    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (IGNORED_SCHEMES.has(event.textEditor.document.uri.scheme)) {
        return;
      }
      if (config.triggerMode === "hoverOnly") {
        // Still initialize if editor had no anchor yet.
        if (!editorAnchors.has(getEditorKey(event.textEditor))) {
          editorAnchors.set(
            getEditorKey(event.textEditor),
            getSelectionAnchor(event.textEditor)
          );
          refreshEditor(event.textEditor);
        }
        return;
      }

      editorAnchors.set(
        getEditorKey(event.textEditor),
        getSelectionAnchor(event.textEditor)
      );
      refreshEditor(event.textEditor);
    }),

    vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
      refreshEditor(event.textEditor);
    }),

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      refreshEditor(editor);
    }),

    vscode.window.onDidChangeVisibleTextEditors(() => {
      refreshAllVisibleEditors();
    }),

    vscode.workspace.onDidChangeTextDocument((event) => {
      const docUri = event.document.uri.toString();
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.toString() === docUri) {
          refreshEditor(editor);
        }
      }
    }),

    vscode.workspace.onDidCloseTextDocument((document) => {
      const prefix = `${document.uri.toString()}::`;
      for (const key of editorAnchors.keys()) {
        if (key.startsWith(prefix)) {
          editorAnchors.delete(key);
        }
      }
    }),

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("hoverBlockDimmer")) {
        config = getFocusModeConfig();
        decorationManager.syncConfiguration(config);
        refreshAllVisibleEditors();
      }
    }),

    vscode.commands.registerCommand("hoverBlockDimmer.toggle", async () => {
      await updateConfigValue("enabled", !config.enabled);
    }),

    vscode.commands.registerCommand(
      "hoverBlockDimmer.switchEffectStyle",
      async () => {
        await pickEffectStyle(config.effectStyle);
      }
    ),

    vscode.commands.registerCommand(
      "hoverBlockDimmer.switchTriggerMode",
      async () => {
        await pickTriggerMode(config.triggerMode);
      }
    ),

    vscode.commands.registerCommand(
      "hoverBlockDimmer.switchFocusScope",
      async () => {
        await pickFocusScope(config.focusScope);
      }
    ),

    vscode.commands.registerCommand("hoverBlockDimmer.applyPreset", async () => {
      await pickPreset();
    }),

    vscode.commands.registerCommand("hoverBlockDimmer.quickMenu", async () => {
      await openQuickMenu(config);
    })
  );

  refreshAllVisibleEditors();
}

export function deactivate(): void {
  // Subscriptions handle disposing decorations and status bar items.
}

async function openQuickMenu(config: FocusModeConfig): Promise<void> {
  const editorHoverCfg = vscode.workspace.getConfiguration("editor");
  const currentHoverDelay = editorHoverCfg.get<number>("hover.delay", 300);

  interface MenuItem extends vscode.QuickPickItem {
    action: () => Promise<void>;
  }

  const items: MenuItem[] = [
    {
      label: config.enabled
        ? "$(eye-closed) Turn Off HoverBlock Dimmer"
        : "$(eye) Turn On HoverBlock Dimmer",
      description: `Currently ${config.enabled ? "Enabled" : "Disabled"}`,
      action: () => updateConfigValue("enabled", !config.enabled),
    },
    {
      label: "$(sparkle) Switch Effect Style",
      description: `Current: ${config.effectStyle}`,
      detail: "Dim+Blur, Dim Only, Blur Only, or Gradient Falloff",
      action: () => pickEffectStyle(config.effectStyle),
    },
    {
      label: "$(mouse) Switch Trigger Mode",
      description: `Current: ${config.triggerMode}`,
      detail: "Cursor + Mouse Hover, Mouse Hover Only, or Cursor Only",
      action: () => pickTriggerMode(config.triggerMode),
    },
    {
      label: "$(list-selection) Switch Focus Scope",
      description: `Current: ${config.focusScope}`,
      detail: "1 Line, Paragraph, or Code Block",
      action: () => pickFocusScope(config.focusScope),
    },
    {
      label: "$(sliders) Apply Intensity Preset",
      description: `Near: ${config.nearOpacity} (${config.nearLines}L), Dim: ${config.dimOpacity}, Blur: ${config.blurAmountPx}px`,
      detail:
        "2-Tier Block Dim (Default), Subtle, Deep Dim + Blur, Pure Blur, or Gradient Spotlight",
      action: () => pickPreset(),
    },
    {
      label: "$(fold-down) Set Transition Border Lines (nearDecoration)",
      description: `Current: ${config.nearLines} slightly dimmed line(s) above & below block`,
      detail: "0 = sharp edge, 1 = smooth 1-line transition (recommended)",
      action: () => pickNearLines(config.nearLines),
    },
    {
      label: "$(list-flat) Set Extra Context Lines",
      description: `Current: ${config.contextLines} line(s) above/below`,
      detail:
        "Keeps surrounding lines at full brightness in 1-line mode or single-line blocks",
      action: () => pickContextLines(config.contextLines),
    },
    {
      label:
        currentHoverDelay <= 60
          ? "$(history) Restore Default Hover Delay (300ms)"
          : "$(zap) Set Instant Hover Response (editor.hover.delay = 50ms)",
      description: `Current editor.hover.delay: ${currentHoverDelay}ms`,
      detail:
        "Makes mouse-hover line focus react almost instantaneously across lines",
      action: async () => {
        const nextDelay = currentHoverDelay <= 60 ? 300 : 50;
        await editorHoverCfg.update(
          "hover.delay",
          nextDelay,
          vscode.ConfigurationTarget.Global
        );
        void vscode.window.showInformationMessage(
          `HoverBlock Dimmer: Set editor.hover.delay to ${nextDelay}ms`
        );
      },
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "HoverBlock Dimmer Settings",
  });
  if (picked) {
    await picked.action();
  }
}

async function pickEffectStyle(current: EffectStyle): Promise<void> {
  const options: Array<vscode.QuickPickItem & { value: EffectStyle }> = [
    {
      label: "Dim + Blur",
      description: current === "dimAndBlur" ? "(Current)" : undefined,
      detail: "Reduces opacity and blurs unfocused lines",
      value: "dimAndBlur",
    },
    {
      label: "Dim Only",
      description: current === "dimOnly" ? "(Current)" : undefined,
      detail:
        "Two-tier dimming (nearDecoration slightly dimmed + dimDecoration strongly dimmed)",
      value: "dimOnly",
    },
    {
      label: "Blur Only",
      description: current === "blurOnly" ? "(Current)" : undefined,
      detail: "Blurs unfocused lines without changing opacity",
      value: "blurOnly",
    },
    {
      label: "Gradient Spotlight",
      description: current === "gradient" ? "(Current)" : undefined,
      detail: "Gradually dims and blurs lines across near, mid, and far bands",
      value: "gradient",
    },
  ];

  const picked = await vscode.window.showQuickPick(options, {
    placeHolder: "Select HoverBlock Dimmer Effect Style",
  });
  if (picked) {
    await updateConfigValue("effectStyle", picked.value);
  }
}

async function pickTriggerMode(current: TriggerMode): Promise<void> {
  const options: Array<vscode.QuickPickItem & { value: TriggerMode }> = [
    {
      label: "Cursor + Mouse Hover",
      description: current === "cursorAndHover" ? "(Current)" : undefined,
      detail: "Focus moves with both cursor movement and mouse hover",
      value: "cursorAndHover",
    },
    {
      label: "Mouse Hover Only",
      description: current === "hoverOnly" ? "(Current)" : undefined,
      detail: "Focus follows the line your mouse hovers over",
      value: "hoverOnly",
    },
    {
      label: "Cursor Only",
      description: current === "cursorOnly" ? "(Current)" : undefined,
      detail: "Focus follows only your editor cursor/selection",
      value: "cursorOnly",
    },
  ];

  const picked = await vscode.window.showQuickPick(options, {
    placeHolder: "Select HoverBlock Dimmer Trigger Mode",
  });
  if (picked) {
    await updateConfigValue("triggerMode", picked.value);
  }
}

async function pickFocusScope(current: FocusScope): Promise<void> {
  const options: Array<vscode.QuickPickItem & { value: FocusScope }> = [
    {
      label: "1 Line",
      description: current === "line" ? "(Current)" : undefined,
      detail: "Focus only on 1 line (or active multi-line selection)",
      value: "line",
    },
    {
      label: "Paragraph",
      description: current === "paragraph" ? "(Current)" : undefined,
      detail: "Focus on contiguous non-empty lines around the anchor line",
      value: "paragraph",
    },
    {
      label: "Code Block",
      description: current === "block" ? "(Current)" : undefined,
      detail: "Focus on the enclosing indentation code block",
      value: "block",
    },
  ];

  const picked = await vscode.window.showQuickPick(options, {
    placeHolder: "Select HoverBlock Dimmer Focus Scope",
  });
  if (picked) {
    await updateConfigValue("focusScope", picked.value);
  }
}

async function pickNearLines(current: number): Promise<void> {
  const counts = [0, 1, 2, 3];
  const options = counts.map((n) => ({
    label:
      n === 0
        ? "0 lines (No nearDecoration transition)"
        : `${n} line(s) slightly dimmed above & below block`,
    description: current === n ? "(Current)" : undefined,
    value: n,
  }));

  const picked = await vscode.window.showQuickPick(options, {
    placeHolder: "Select nearDecoration transition lines around focused block",
  });
  if (picked) {
    await updateConfigValue("nearLines", picked.value);
  }
}

async function pickContextLines(current: number): Promise<void> {
  const counts = [0, 1, 2, 3, 5, 10];
  const options = counts.map((n) => ({
    label: n === 0 ? "0 lines (Strict 1-Line Focus)" : `${n} line(s) above & below`,
    description: current === n ? "(Current)" : undefined,
    value: n,
  }));

  const picked = await vscode.window.showQuickPick(options, {
    placeHolder: "Select extra clear context lines around focus",
  });
  if (picked) {
    await updateConfigValue("contextLines", picked.value);
  }
}

async function pickPreset(): Promise<void> {
  interface PresetItem extends vscode.QuickPickItem {
    effectStyle: EffectStyle;
    nearOpacity?: number;
    nearLines?: number;
    dimOpacity?: number;
    blurAmountPx?: number;
  }

  const presets: PresetItem[] = [
    {
      label: "2-Tier Block Dim (Default)",
      detail: "Near 0.55 (1 line), Outer Dim 0.22, No Blur (Dim Only)",
      effectStyle: "dimOnly",
      nearOpacity: 0.55,
      nearLines: 1,
      dimOpacity: 0.22,
    },
    {
      label: "Subtle Dim",
      detail: "Near 0.70 (1 line), Outer Dim 0.42 (Dim Only)",
      effectStyle: "dimOnly",
      nearOpacity: 0.7,
      nearLines: 1,
      dimOpacity: 0.42,
    },
    {
      label: "Deep Dim + Blur",
      detail: "Near 0.45 (1 line), Outer Dim 0.14, Blur 2.5px (Dim + Blur)",
      effectStyle: "dimAndBlur",
      nearOpacity: 0.45,
      nearLines: 1,
      dimOpacity: 0.14,
      blurAmountPx: 2.5,
    },
    {
      label: "Pure Blur (No Dim)",
      detail: "Full opacity, Blur 2.0px (Blur Only)",
      effectStyle: "blurOnly",
      nearLines: 1,
      blurAmountPx: 2.0,
    },
    {
      label: "Gradient Spotlight",
      detail: "Near 0.60, Outer Dim 0.18, Blur 1.8px (3-Band Gradient Falloff)",
      effectStyle: "gradient",
      nearOpacity: 0.6,
      nearLines: 2,
      dimOpacity: 0.18,
      blurAmountPx: 1.8,
    },
  ];

  const picked = await vscode.window.showQuickPick(presets, {
    placeHolder: "Apply a HoverBlock Dimmer Intensity Preset",
  });
  if (!picked) {
    return;
  }

  await updateConfigValue("effectStyle", picked.effectStyle);
  if (picked.nearOpacity !== undefined) {
    await updateConfigValue("nearOpacity", picked.nearOpacity);
  }
  if (picked.nearLines !== undefined) {
    await updateConfigValue("nearLines", picked.nearLines);
  }
  if (picked.dimOpacity !== undefined) {
    await updateConfigValue("dimOpacity", picked.dimOpacity);
  }
  if (picked.blurAmountPx !== undefined) {
    await updateConfigValue("blurAmountPx", picked.blurAmountPx);
  }
}

function formatScopeLabel(config: FocusModeConfig): string {
  switch (config.focusScope) {
    case "line":
      return config.contextLines > 0
        ? `1+${config.contextLines * 2} Lines`
        : "1-Line";
    case "paragraph":
      return "Paragraph";
    case "block":
      return "Block";
  }
}

function formatTriggerLabel(mode: TriggerMode): string {
  switch (mode) {
    case "cursorAndHover":
      return "Hover+Cursor";
    case "hoverOnly":
      return "Hover";
    case "cursorOnly":
      return "Cursor";
  }
}
