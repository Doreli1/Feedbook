const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;
// pnpm's strict, non-hoisted node_modules layout (unlike npm/yarn) means a
// package's own transitive deps aren't necessarily siblings on disk — Metro's
// default resolver assumes a hoisted layout and fails deep inside .pnpm's
// store (e.g. @expo/metro-runtime importing bare "expo") without this.
// Documented fix: https://docs.expo.dev/guides/monorepos/
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// pnpm's node_modules entries are symlinks into its central .pnpm store —
// Metro must be told to follow them, or resolution fails even though the
// path genuinely exists on disk (confirmed via `ls -la`, not a guess).
config.resolver.unstable_enableSymlinks = true;

// The above two still weren't enough in practice (verified against the real
// dev server, not assumed): a peer dependency like `expo` — pulled in by
// expo-router from deep inside the .pnpm store — kept failing to resolve
// even though `apps/mobile/node_modules/expo` and `app/node_modules/expo`
// are both real, valid symlinks. Metro's directory crawler on Windows
// doesn't reliably pick up pnpm's symlinked entries even with
// unstable_enableSymlinks on. extraNodeModules sidesteps the crawler
// entirely: any bare import Metro can't otherwise place resolves straight to
// its real path under the workspace root's node_modules.
config.resolver.extraNodeModules = new Proxy(
  {},
  { get: (_target, name) => path.join(workspaceRoot, 'node_modules', name) },
);

// extraNodeModules only intercepts bare specifiers ("expo-router"), not
// workspace-relative ones — and Expo's own dev-server manifest builds the
// router's entry request as the relative path
// "./apps/mobile/node_modules/expo-router/entry" (resolved against the
// watched workspace root). The first attempt at a fallback here used
// require.resolve, which DOES find the file — but by fully dereferencing the
// symlink down into node_modules/.pnpm/expo-router@.../node_modules/..., a
// path Metro's crawler never watched, so it then failed at the next step
// ("Failed to get the SHA-1") instead. The fix is to resolve only as far as
// the LOCAL symlink under this project's own node_modules (the same shape of
// path every other successfully-bundled import already goes through), never
// past it into the real .pnpm store path.
const CANDIDATE_EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.json'];
function resolveViaLocalNodeModules(target) {
  const marker = `${path.sep}node_modules${path.sep}`;
  const idx = target.lastIndexOf(marker);
  if (idx === -1) return null;
  const suffix = target.slice(idx + marker.length);
  for (const root of [workspaceRoot, projectRoot]) {
    const base = path.join(root, 'node_modules', suffix);
    for (const ext of CANDIDATE_EXTS) {
      if (fs.existsSync(base + ext)) return base + ext;
    }
  }
  return null;
}

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return defaultResolveRequest
      ? defaultResolveRequest(context, moduleName, platform)
      : context.resolveRequest(context, moduleName, platform);
  } catch (error) {
    const target = moduleName.startsWith('.')
      ? path.resolve(path.dirname(context.originModulePath), moduleName)
      : moduleName;
    const localPath = resolveViaLocalNodeModules(target);
    if (localPath) return { type: 'sourceFile', filePath: localPath };
    throw error;
  }
};

module.exports = withNativeWind(config, { input: './global.css' });
