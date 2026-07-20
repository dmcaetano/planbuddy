import { z } from "zod";

/** Convenience presets the client offers alongside free-text custom labels. */
export const PRESET_FRIEND_LABELS = ["Family", "Close friends"] as const;

export const friendLabelNameSchema = z.string().trim().min(1).max(24);

export const friendLabelsReplaceSchema = z.object({
  labels: z.array(friendLabelNameSchema).max(20),
});
