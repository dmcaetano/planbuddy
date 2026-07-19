import { z } from "zod";
import { SCALES } from "./scale.js";

/* ---------------------------------------------------------------------- */
/* Auth                                                                    */
/* ---------------------------------------------------------------------- */

export const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

export const homeBaseSchema = z.object({
  label: z.string().trim().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/* ---------------------------------------------------------------------- */
/* Participants                                                            */
/* ---------------------------------------------------------------------- */

export const participantCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["person", "pet"]),
  relationship: z.string().trim().max(120).optional().nullable(),
});

export const participantUpdateSchema = participantCreateSchema.partial();

/* ---------------------------------------------------------------------- */
/* Memory: constraints / tastes                                            */
/* ---------------------------------------------------------------------- */

export const constraintCreateSchema = z.object({
  participantId: z.string().uuid().nullable().optional(),
  text: z.string().trim().min(1).max(500),
});

export const constraintUpdateSchema = z.object({
  text: z.string().trim().min(1).max(500).optional(),
  participantId: z.string().uuid().nullable().optional(),
  status: z.enum(["verified", "active_unverified"]).optional(),
});

export const tasteCreateSchema = z.object({
  participantId: z.string().uuid().nullable().optional(),
  text: z.string().trim().min(1).max(300),
  polarity: z.enum(["love", "avoid"]),
  weight: z.number().min(0).max(1).optional(),
});

export const tasteUpdateSchema = tasteCreateSchema.partial();

export const hunchUpdateSchema = z.object({
  action: z.enum(["confirm", "dismiss"]),
});

/* ---------------------------------------------------------------------- */
/* Plan specs                                                              */
/* ---------------------------------------------------------------------- */

export const planSpecCreateSchema = z.object({
  scale: z.enum(SCALES),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  radiusKm: z.number().min(1).max(20000).optional(),
  moodContext: z.string().trim().max(280).optional().nullable(),
  participantIds: z.array(z.string().uuid()).min(1),
});

export const notThisSchema = z.object({
  reason: z.string().trim().min(1).max(300),
});

export const feedbackCreateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional().nullable(),
});

/* ---------------------------------------------------------------------- */
/* Chat                                                                     */
/* ---------------------------------------------------------------------- */

export const chatMessageCreateSchema = z.object({
  content: z.string().trim().min(1).max(2000),
});

/* ---------------------------------------------------------------------- */
/* DeepSeek contract: Generate                                             */
/* ---------------------------------------------------------------------- */

export const aiBeatSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(400),
  category: z.string().min(1).max(60),
  indoor: z.boolean(),
});

export const aiCitationSchema = z.object({
  factId: z.string().min(1).max(120),
  quote: z.string().min(1).max(300),
  source: z.string().min(1).max(120),
});

export const aiConstraintComplianceSchema = z.object({
  constraintId: z.string().min(1).max(120),
  satisfied: z.boolean(),
});

export const aiCandidateSchema = z.object({
  title: z.string().min(1).max(120),
  rationale: z.string().min(1).max(600),
  category: z.string().min(1).max(60),
  indoor: z.boolean(),
  beats: z.array(aiBeatSchema).min(1).max(3),
  destinationAnchor: z.string().max(200).nullable().optional(),
  resolverVenueIds: z.array(z.string().max(200)).default([]),
  citations: z.array(aiCitationSchema).default([]),
  constraintCompliance: z.array(aiConstraintComplianceSchema).default([]),
  travelEstimateKm: z.number().min(0).max(20000).nullable().optional(),
});
export type AiCandidate = z.infer<typeof aiCandidateSchema>;

export const aiGenerateResponseSchema = z.object({
  candidates: z.array(aiCandidateSchema).min(1).max(8),
});
export type AiGenerateResponse = z.infer<typeof aiGenerateResponseSchema>;

/* ---------------------------------------------------------------------- */
/* DeepSeek contract: Chat                                                 */
/* ---------------------------------------------------------------------- */

export const aiExtractionSchema = z.object({
  participantName: z.string().max(120).nullable().optional(),
  kind: z.enum(["constraint", "taste"]),
  text: z.string().min(1).max(300),
  quote: z.string().max(400).nullable().optional(),
  quoteStart: z.number().int().min(0).nullable().optional(),
  quoteEnd: z.number().int().min(0).nullable().optional(),
  polarity: z.enum(["love", "avoid"]).nullable().optional(),
  confidence: z.number().min(0).max(1),
});
export type AiExtraction = z.infer<typeof aiExtractionSchema>;

export const aiSpecUpdateSchema = z.object({
  scale: z.enum(SCALES).nullable().optional(),
  moodContext: z.string().max(280).nullable().optional(),
});

export const aiChatResponseSchema = z.object({
  reply: z.string().min(1).max(1200),
  specUpdate: aiSpecUpdateSchema.nullable().optional(),
  extractions: z.array(aiExtractionSchema).max(10).default([]),
});
export type AiChatResponse = z.infer<typeof aiChatResponseSchema>;

/* ---------------------------------------------------------------------- */
/* DeepSeek contract: Feedback                                             */
/* ---------------------------------------------------------------------- */

export const aiFeedbackEvidenceSchema = z.object({
  participantName: z.string().max(120).nullable().optional(),
  text: z.string().min(1).max(300),
  polarity: z.enum(["love", "avoid"]),
  confidence: z.number().min(0).max(1),
});
export type AiFeedbackEvidence = z.infer<typeof aiFeedbackEvidenceSchema>;

export const aiFeedbackResponseSchema = z.object({
  evidence: z.array(aiFeedbackEvidenceSchema).max(5).default([]),
});
export type AiFeedbackResponse = z.infer<typeof aiFeedbackResponseSchema>;
