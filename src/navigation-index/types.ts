export type ProjectNavigationIndex = {
  version: string;
  generated_at: string;
  system: { id: string; name: string };
  artifacts: Record<string, CompiledArtifactNode>;
};

export type CompiledArtifactNode = {
  id: string;
  files: {
    path_patterns: string[];
    exclude_patterns: string[];
  };
  properties: {
    type: string;
    authority: "canonical" | "derived" | "generated" | "control";
    manual_edit: "allowed" | "discouraged" | "forbidden";
    change_control: "none" | "approval-required" | "regeneration-required";
  };
  relations: {
    source_artifacts: string[];
    derived_artifacts: string[];
  };
  operations: {
    producers: ArtifactOperation[];
    validators: ArtifactOperation[];
    consumers: ArtifactOperation[];
  };
  agents: {
    owners: string[];
    editors: string[];
    readers: string[];
  };
  routes: {
    update?: ArtifactRoute[];
    regenerate?: ArtifactRoute[];
    validate?: ArtifactRoute[];
  };
};

export type ArtifactOperation = {
  tool: string;
  cli_contract: string;
  command: string;
  slot: string;
  invokable_by: string[];
};

export type ArtifactRoute = {
  purpose: "update" | "regenerate" | "validate";
  steps: ArtifactRouteStep[];
};

export type ArtifactRouteStep =
  | { type: "edit_artifact"; artifact: string; candidate_agents: string[] }
  | { type: "run_operation"; operation: string; candidate_agents: string[] }
  | { type: "request_review"; artifact: string; candidate_agents: string[] };
