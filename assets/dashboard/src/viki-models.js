export function vikiModelSelection(provider, savedModel = "") {
  const selected = savedModel || provider?.defaultModel || "";
  const models = [...new Map((provider?.models || []).filter((item) => item.id).map((item) => [item.id, item])).values()];
  if (selected && !models.some((item) => item.id === selected)) models.unshift({ id: selected, label: selected });
  return { selected, models, label: models.find((item) => item.id === selected)?.label || selected };
}
