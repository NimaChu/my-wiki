export type VikiComposerKey = {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
};

export function shouldSubmitVikiComposer(event: VikiComposerKey): boolean;
