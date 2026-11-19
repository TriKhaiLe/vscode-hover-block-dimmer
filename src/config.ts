import * as vscode from "vscode";
import {
  EffectStyle,
  FocusModeConfig,
  FocusScope,
  TriggerMode,
} from "./types";

const CONFIG_SECTION = "hoverBlockDimmer";

const VALID_TRIGGER_MODES: readonly TriggerMode[] = [
  "cursorAndHover",
  "hoverOnly",
  "cursorOnly",
];

const VALID_FOCUS_SCOPES: readonly FocusScope[] = [
  "line",
  "paragraph",
  "block",
];

const VALID_EFFECT_STYLES: readonly EffectStyle[] = [
  "dimAndBlur",
  "dimOnly",
  "blurOnly",
  "gradient",
];

export function getFocusModeConfig(): FocusModeConfig {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);

  const rawTrigger = cfg.get<string>("triggerMode", "cursorOnly");
  const triggerMode: TriggerMode = VALID_TRIGGER_MODES.includes(
    rawTrigger as TriggerMode
  )
    ? (rawTrigger as TriggerMode)
    : "cursorOnly";

  const rawScope = cfg.get<string>("focusScope", "block");
  const focusScope: FocusScope = VALID_FOCUS_SCOPES.includes(
    rawScope as FocusScope
  )
    ? (rawScope as FocusScope)
    : "block";

  const rawEffect = cfg.get<string>("effectStyle", "dimOnly");
  const effectStyle: EffectStyle = VALID_EFFECT_STYLES.includes(
    rawEffect as EffectStyle
  )
    ? (rawEffect as EffectStyle)
    : "dimOnly";

  const contextLines = clampInt(cfg.get<number>("contextLines", 1), 0, 30);
  const maxBlockLines = clampInt(cfg.get<number>("maxBlockLines", 15), 3, 100);
  const nearLines = clampInt(cfg.get<number>("nearLines", 1), 0, 10);
  const nearOpacity = clampNumber(
    cfg.get<number>("nearOpacity", 0.55),
    0.1,
    0.95
  );
  const dimOpacity = clampNumber(
    cfg.get<number>("dimOpacity", 0.22),
    0.05,
    0.95
  );
  const blurAmountPx = clampNumber(cfg.get<number>("blurAmountPx", 1.5), 0, 10);

  return {
    enabled: cfg.get<boolean>("enabled", true),
    triggerMode,
    focusScope,
    contextLines,
    maxBlockLines,
    nearLines,
    nearOpacity,
    effectStyle,
    dimOpacity,
    blurAmountPx,
    highlightFocusedLine: cfg.get<boolean>("highlightFocusedLine", false),
    focusedLineBackground: cfg.get<string>(
      "focusedLineBackground",
      "rgba(255, 255, 255, 0.04)"
    ),
    focusedLineBorderColor: cfg.get<string>(
      "focusedLineBorderColor",
      "rgba(56, 189, 248, 0.85)"
    ),
  };
}

export async function updateConfigValue<K extends keyof FocusModeConfig>(
  key: K,
  value: FocusModeConfig[K],
  target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await cfg.update(key, value, target);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.round(Math.max(min, Math.min(max, value)));
}
