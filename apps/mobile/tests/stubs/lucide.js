// Icons draw nothing in tests. lucide's own entry loads its ~3800 icon files,
// which takes longer than a test is allowed.
function Icon() {
  return null;
}

module.exports = new Proxy({}, { get: (_, name) => (name === '__esModule' ? true : Icon) });
