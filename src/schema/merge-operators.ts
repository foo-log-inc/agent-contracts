import { z } from "zod";

export const AppendOperatorSchema = z.object({
  $append: z.record(z.string(), z.any()),
});
export type AppendOperator = z.infer<typeof AppendOperatorSchema>;

export const PrependOperatorSchema = z.object({
  $prepend: z.record(z.string(), z.any()),
});
export type PrependOperator = z.infer<typeof PrependOperatorSchema>;

export const InsertAfterOperatorSchema = z.object({
  $insert_after: z.object({
    after: z.string(),
    entries: z.record(z.string(), z.any()),
  }),
});
export type InsertAfterOperator = z.infer<typeof InsertAfterOperatorSchema>;

export const ReplaceOperatorSchema = z.object({ $replace: z.any() });
export type ReplaceOperator = z.infer<typeof ReplaceOperatorSchema>;

export const RemoveOperatorSchema = z.object({
  $remove: z.array(z.union([z.string(), z.object({ id: z.string() })])),
});
export type RemoveOperator = z.infer<typeof RemoveOperatorSchema>;

export type MergeableRecord<T> =
  | Record<string, T>
  | { $append: Record<string, unknown> }
  | { $prepend: Record<string, unknown> }
  | { $insert_after: { after: string; entries: Record<string, unknown> } }
  | { $replace: unknown }
  | { $remove: (string | { id: string })[] };
