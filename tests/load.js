/* Loads the browser modules into Node (they attach to globalThis.LC). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const files = ['util', 'knowledge', 'inventory', 'hardware', 'files', 'space', 'projects', 'relations', 'cleanup', 'folders', 'house', 'apply', 'compare', 'findings', 'model'];
for (const f of files) {
  const file = path.join(__dirname, '..', 'web', f + '.js');
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
}
module.exports = globalThis.LC;
