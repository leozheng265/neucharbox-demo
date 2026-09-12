// Node resolve hook: map the page's import-map specifiers ('three', 'three/addons/…') to the vendored files.
export async function resolve(specifier, context, next) {
  if (specifier === 'three') return next(new URL('../vendor/three/three.module.js', import.meta.url).href, context);
  if (specifier.startsWith('three/addons/')) return next(new URL('../vendor/three/addons/' + specifier.slice('three/addons/'.length), import.meta.url).href, context);
  return next(specifier, context);
}
