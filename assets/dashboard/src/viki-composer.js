export function shouldSubmitVikiComposer({ key, shiftKey = false, isComposing = false, keyCode = 0 }) {
  return key === "Enter" && !shiftKey && !isComposing && keyCode !== 229;
}
