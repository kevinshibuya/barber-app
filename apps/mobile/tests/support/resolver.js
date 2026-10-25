// Reanimated and its worklets runtime run their JS implementations in Jest,
// the rule of their own resolvers (`react-native-reanimated/jest/resolver`),
// on top of the React Native preset's. Theirs match a package by any path
// that names it, and under pnpm the folders of the packages that depend on
// worklets name it too, so this one matches the package's own folder.
const preset = require(
  require.resolve('@react-native/jest-preset/jest/resolver', { paths: [require.resolve('jest-expo/package.json')] }),
);

// Reanimated's files with a native twin that Jest must not load.
const REANIMATED_WEB_ONLY = new Set([
  'initializers',
  'mutables',
  'mappers',
  'ConfigHelper',
  'UpdateLayoutAnimations',
  'useAnimatedRef',
  'useAnimatedStyle',
  'WorkletEventHandler',
  'JSPropsUpdater',
  'updateProps',
  'util',
  'css/component/AnimatedComponent',
]);

function inPackage(basedir, name) {
  return basedir.includes(`/node_modules/${name}/`) || basedir.endsWith(`/node_modules/${name}`);
}

function webOnly(request, basedir) {
  if (inPackage(basedir, 'react-native-worklets') || request.startsWith('react-native-worklets')) return true;
  if (!request.startsWith('.') || !inPackage(basedir, 'react-native-reanimated')) return false;
  const basename = request.split('/').pop();
  return [...REANIMATED_WEB_ONLY].some((entry) => (entry.includes('/') ? request.endsWith(entry) : basename === entry));
}

module.exports = (request, options) =>
  preset(
    request,
    webOnly(request, options.basedir)
      ? { ...options, extensions: options.extensions?.filter((ext) => !ext.includes('native')) }
      : options,
  );
