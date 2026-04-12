/**
 * Minimal Jest transform: ESM → CJS for public/js/core/*.js files.
 *
 * Converts `export function foo()` / `export const bar` / `export { x, y }`
 * into plain declarations + `module.exports = { foo, bar, x, y }` at the end.
 *
 * Converts `import { a, b } from './mod.js'` into
 * `const { a, b } = require('./mod.js')`.
 *
 * Only applied to files matching the transform pattern in jest.config.js.
 */
module.exports = {
  process(src) {
    const names = [];

    // import { a, b } from './mod.js'  →  const { a, b } = require('./mod.js')
    let code = src.replace(
      /^import\s*\{([^}]+)\}\s*from\s*(['"])(.*?)\2\s*;?/gm,
      (_match, bindings, _quote, specifier) => {
        return `const {${bindings}} = require('${specifier}');`;
      },
    );

    // import defaultExport from './mod.js'  →  const defaultExport = require('./mod.js')
    code = code.replace(
      /^import\s+(\w+)\s+from\s*(['"])(.*?)\2\s*;?/gm,
      (_match, binding, _quote, specifier) => {
        return `const ${binding} = require('${specifier}');`;
      },
    );

    // export function foo(...) / export async function foo(...) / export class Foo / export const x = ...
    code = code.replace(
      /^export\s+(?:(async)\s+)?(function|const|let|var|class)\s+(\w+)/gm,
      (_match, asyncKw, keyword, name) => {
        names.push(name);
        return asyncKw ? `${asyncKw} ${keyword} ${name}` : `${keyword} ${name}`;
      },
    );

    // export { a, b, c }
    code = code.replace(/^export\s*\{([^}]+)\}/gm, (_match, list) => {
      for (const name of list.split(',').map((n) => n.trim())) {
        if (name && !names.includes(name)) names.push(name);
      }
      return '';
    });

    if (names.length > 0) {
      code += `\nmodule.exports = { ${names.join(', ')} };\n`;
    }

    return { code };
  },
};
