export { resolveBase, resolveLocalBase, BaseResolveError } from "./base-resolver.js";
export {
  mergeDsl,
  mergeSection,
  mergeEntityMaps,
  deepMergeEntities,
  applyArrayMergeOperator,
  hasOperator,
  MergeError,
  type SectionMode,
} from "./merger.js";
export { resolve, type ResolveResult } from "./resolve.js";
export { resolveToolExtends, ToolExtendsError } from "./tool-extends.js";
export { substituteVars, VarsSubstitutionError } from "./substitute-vars.js";
export { expandDefaults } from "./expand-defaults.js";
