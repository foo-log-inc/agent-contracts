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
export { resolveClone, CloneError } from "./clone.js";
export { resolveToolExtends, ToolExtendsError } from "./tool-extends.js";
export {
  resolveAgentEffects,
  resolveTaskEffects,
  resolveToolEffects,
  isNarrowOnlyOverride,
  collectAgentArtifactProducers,
  collectAgentArtifactConsumers,
  normalizeDerivedFrom,
  type EffectiveEffects,
} from "./effects.js";
export { substituteVars, VarsSubstitutionError } from "./substitute-vars.js";
export { expandDefaults } from "./expand-defaults.js";
export {
  resolveArtifactBinding,
  type ArtifactBindingDiagnostic,
  type ArtifactBindingResult,
} from "./artifact-binding.js";
export {
  resolveBound,
  type BoundResolveOptions,
  type BoundResolveResult,
} from "./bound-resolve.js";
