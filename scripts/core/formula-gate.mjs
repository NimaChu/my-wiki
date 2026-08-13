import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FORMULA_DEPENDENCY_ROOT = path.resolve(here, "..", "..", "assets", "dashboard");

const runtimeCache = new Map();

export async function checkMarkdownFormulas(markdown, {
  dependencyRoot = DEFAULT_FORMULA_DEPENDENCY_ROOT,
  repairSafeDelimiters = false
} = {}) {
  const source = String(markdown || "");
  const firstPass = await parseMathNodes(source, dependencyRoot);
  const repairs = repairSafeDelimiters ? collectSafeDelimiterRepairs(source, firstPass.nodes) : [];
  const normalizedMarkdown = applyReplacements(source, repairs);
  const parsed = repairs.length > 0 ? await parseMathNodes(normalizedMarkdown, dependencyRoot) : firstPass;
  const pageAtLine = pageLocator(normalizedMarkdown);
  const errors = [];
  const strictWarnings = [];

  for (const node of parsed.nodes) {
    const nodeWarnings = [];
    try {
      renderFormula(parsed.katex, node.value, {
        displayMode: node.type === "math",
        throwOnError: true,
        strict: (code, message, token) => {
          nodeWarnings.push({
            code: String(code || "strict"),
            message: conciseKatexWarning(message),
            token: String(token?.text || "").slice(0, 120)
          });
          return "ignore";
        },
        trust: false
      });
    } catch (error) {
      const line = Number(node.position?.start?.line || 0);
      errors.push({
        line,
        column: Number(node.position?.start?.column || 0),
        page: pageAtLine(line),
        display: node.type === "math",
        tex: node.value,
        message: conciseKatexError(error)
      });
    }
    const line = Number(node.position?.start?.line || 0);
    const seen = new Set();
    for (const warning of nodeWarnings) {
      const key = `${warning.code}:${warning.message}:${warning.token}`;
      if (seen.has(key)) continue;
      seen.add(key);
      strictWarnings.push({
        line,
        column: Number(node.position?.start?.column || 0),
        page: pageAtLine(line),
        display: node.type === "math",
        tex: node.value,
        ...warning
      });
    }
  }

  return {
    markdown: normalizedMarkdown,
    checked: parsed.nodes.length,
    errors,
    strictWarnings,
    repairs: repairs.map(({ start: _start, end: _end, replacement: _replacement, ...repair }) => repair),
    syntaxErrorPages: uniquePages(errors),
    strictWarningPages: uniquePages(strictWarnings),
    repairPages: uniquePages(repairs)
  };
}

export function shouldGateExtractedFormulas({ extractionMethod = "", extractionQuality = null, formulaRiskPages = "" } = {}) {
  if (String(extractionMethod || "").trim().toLowerCase() === "mineru") return true;
  const pages = extractionQuality?.formulaRiskPages ?? formulaRiskPages;
  return Array.isArray(pages) ? pages.length > 0 : Boolean(String(pages || "").trim());
}

function renderFormula(katex, tex, options) {
  const originalWarn = console.warn;
  try {
    // KaTeX logs missing glyph metrics even when strict warnings are ignored.
    // The gate records parse failures itself, so keep lint and API output clean.
    console.warn = () => {};
    return katex.renderToString(tex, options);
  } finally {
    console.warn = originalWarn;
  }
}

export function formulaSyntaxFollowupReason(result) {
  if (!result?.errors?.length) return "";
  if (result.syntaxErrorPages?.length) return `formula-syntax-error:pages=${compactNumbers(result.syntaxErrorPages)}`;
  const lines = [...new Set(result.errors.map((item) => Number(item.line || 0)).filter((line) => line > 0))];
  return `formula-syntax-error:lines=${compactNumbers(lines) || "unknown"}`;
}

export function formulaStrictFollowupReason(result) {
  if (!result?.strictWarnings?.length) return "";
  if (result.strictWarningPages?.length) return `formula-strict-warning:pages=${compactNumbers(result.strictWarningPages)}`;
  const lines = [...new Set(result.strictWarnings.map((item) => Number(item.line || 0)).filter((line) => line > 0))];
  return `formula-strict-warning:lines=${compactNumbers(lines) || "unknown"}`;
}

export function formulaGateFollowupReasons(result) {
  return [formulaSyntaxFollowupReason(result), formulaStrictFollowupReason(result)].filter(Boolean);
}

export function formulaGateBlocked(result) {
  return Boolean(result?.errors?.length || result?.strictWarnings?.length);
}

async function parseMathNodes(markdown, dependencyRoot) {
  const runtime = await formulaRuntime(dependencyRoot);
  const tree = runtime.parser.parse(markdown);
  const nodes = [];
  walk(tree, (node) => {
    if (node.type === "math" || node.type === "inlineMath") nodes.push(node);
  });
  return { ...runtime, nodes };
}

async function formulaRuntime(dependencyRoot) {
  const root = path.resolve(dependencyRoot || DEFAULT_FORMULA_DEPENDENCY_ROOT);
  if (!runtimeCache.has(root)) {
    runtimeCache.set(root, (async () => {
      const require = createRequire(path.join(root, "package.json"));
      const [{ unified }, { default: remarkParse }, { default: remarkMath }] = await Promise.all([
        import(pathToFileURL(require.resolve("unified")).href),
        import(pathToFileURL(require.resolve("remark-parse")).href),
        import(pathToFileURL(require.resolve("remark-math")).href)
      ]);
      return {
        parser: unified().use(remarkParse).use(remarkMath),
        katex: require("katex")
      };
    })());
  }
  return runtimeCache.get(root);
}

function collectSafeDelimiterRepairs(markdown, nodes) {
  const repairs = [];
  const pageAtLine = pageLocator(markdown);
  for (const node of nodes) {
    if (node.type !== "math") continue;
    const unwrapped = unwrapNestedMathDelimiter(node.value);
    if (!unwrapped) continue;
    const start = Number(node.position?.start?.offset);
    const end = Number(node.position?.end?.offset);
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) continue;
    const block = markdown.slice(start, end);
    const valueOffset = block.indexOf(node.value);
    if (valueOffset < 0) continue;
    const absoluteStart = start + valueOffset;
    const line = Number(node.position?.start?.line || 0);
    repairs.push({
      start: absoluteStart,
      end: absoluteStart + node.value.length,
      replacement: unwrapped.value,
      line,
      column: Number(node.position?.start?.column || 0),
      page: pageAtLine(line),
      kind: unwrapped.kind
    });
  }
  return repairs;
}

function unwrapNestedMathDelimiter(value) {
  const text = String(value || "");
  const leading = text.match(/^\s*/)?.[0] || "";
  const trailing = text.match(/\s*$/)?.[0] || "";
  const trimmed = text.slice(leading.length, text.length - trailing.length);
  const delimiters = [
    { open: "\\(", close: "\\)", kind: "display-wrapped-inline-math" },
    { open: "\\[", close: "\\]", kind: "display-wrapped-display-math" }
  ];
  for (const delimiter of delimiters) {
    if (!trimmed.startsWith(delimiter.open) || !trimmed.endsWith(delimiter.close)) continue;
    const inner = trimmed.slice(delimiter.open.length, -delimiter.close.length);
    return { value: `${leading}${inner}${trailing}`, kind: delimiter.kind };
  }
  return null;
}

function applyReplacements(source, replacements) {
  let output = source;
  for (const replacement of [...replacements].sort((a, b) => b.start - a.start)) {
    output = `${output.slice(0, replacement.start)}${replacement.replacement}${output.slice(replacement.end)}`;
  }
  return output;
}

function pageLocator(markdown) {
  const pages = [];
  const lines = String(markdown || "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^###\s+Page\s+(\d+)\s*$/i);
    if (match) pages.push({ line: index + 1, page: Number(match[1]) });
  }
  return (line) => {
    let page = 0;
    for (const candidate of pages) {
      if (candidate.line > line) break;
      page = candidate.page;
    }
    return page;
  };
}

function uniquePages(items) {
  return [...new Set(items.map((item) => Number(item.page || 0)).filter((page) => page > 0))].sort((a, b) => a - b);
}

function conciseKatexError(error) {
  return String(error?.message || error || "KaTeX could not parse this formula")
    .replace(/^KaTeX parse error:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function conciseKatexWarning(message) {
  return String(message || "KaTeX strict warning")
    .replace(/^LaTeX-incompatible input and strict mode is set to ['"]?warn['"]?:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function compactNumbers(values) {
  const numbers = [...new Set((Array.isArray(values) ? values : []).map(Number).filter((value) => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
  const ranges = [];
  let start = numbers[0];
  let previous = numbers[0];
  for (const value of numbers.slice(1)) {
    if (value === previous + 1) {
      previous = value;
      continue;
    }
    ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = value;
    previous = value;
  }
  if (start !== undefined) ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
  return ranges.join(",");
}

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const child of Array.isArray(node.children) ? node.children : []) walk(child, visit);
}
