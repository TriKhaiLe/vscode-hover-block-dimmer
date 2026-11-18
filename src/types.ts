export type TriggerMode = "cursorAndHover" | "hoverOnly" | "cursorOnly";

export type FocusScope = "line" | "paragraph" | "block";

export type EffectStyle = "dimAndBlur" | "dimOnly" | "blurOnly" | "gradient";

export interface FocusModeConfig {
  enabled: boolean;
  triggerMode: TriggerMode;
  focusScope: FocusScope;
  contextLines: number;
  maxBlockLines: number;
  nearLines: number;
  nearOpacity: number;
  effectStyle: EffectStyle;
  dimOpacity: number;
  blurAmountPx: number;
  highlightFocusedLine: boolean;
  focusedLineBackground: string;
  focusedLineBorderColor: string;
}

export interface LineSpan {
  startLine: number;
  endLine: number;
}

export interface FocusAnchor {
  startLine: number;
  endLine: number;
  source: "cursor" | "hover";
}
