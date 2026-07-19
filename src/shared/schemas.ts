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

export const aiPlanPlaceSchema = z.object({
  name: z.string().min(1).max(160),
  address: z.string().max(240).nullable().optional(),
  kind: z.string().min(1).max(80),
  sourceUrl: z.string().url().max(1000),
  sourceLabel: z.string().min(1).max(160),
  factualNote: z.string().min(1).max(600),
  mapsUrl: z.string().url().max(1500).nullable().optional(),
});

export const aiPlaceResearchResponseSchema = z.object({
  places: z
    .array(
      aiPlanPlaceSchema.extend({
        bestFor: z.array(z.string().min(1).max(100)).min(1).max(5),
        photoSearchTerm: z.string().max(160).nullable().optional(),
      })
    )
    .min(3)
    .max(8),
});
export type AiPlaceResearchResponse = z.infer<typeof aiPlaceResearchResponseSchema>;

export const aiBeatSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(400),
  category: z.string().min(1).max(60),
  indoor: z.boolean(),
  startTime: z.string().max(20).nullable().optional(),
  durationMinutes: z.number().int().min(5).max(1440).nullable().optional(),
  travelMode: z.enum(["walking", "driving", "transit", "ferry"]).nullable().optional(),
  distanceFromPreviousKm: z.number().min(0).max(20000).nullable().optional(),
  travelMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  place: aiPlanPlaceSchema.nullable().optional(),
  directionsUrl: z.string().url().max(2000).nullable().optional(),
});

const aiFallbackSchema = z.object({
  title: z.string().min(1).max(140),
  description: z.string().min(1).max(300),
  place: aiBeatSchema.shape.place,
});

const aiPlanImageSchema = z.object({
  url: z.string().url().max(1500),
  sourceUrl: z.string().url().max(1500),
  attribution: z.string().min(1).max(240),
  caption: z.string().min(1).max(240),
});

const aiPreparationSchema = z.object({
  wear: z.array(z.string().min(1).max(200)).max(8),
  bring: z.array(z.string().min(1).max(200)).max(8),
  pet: z.array(z.string().min(1).max(200)).max(8),
  weatherRule: z.string().min(1).max(400),
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
  walkingDistanceKm: z.number().min(0).max(200).nullable().optional(),
  walkingMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  estimatedCost: z.string().max(120).nullable().optional(),
  checkBeforeYouGo: z.array(z.string().min(1).max(240)).max(8).default([]),
  fallback: aiFallbackSchema.nullable().optional(),
  photoSearchTerm: z.string().max(160).nullable().optional(),
  heroImage: aiPlanImageSchema.nullable().optional(),
  routeMapsUrl: z.string().url().max(2000).nullable().optional(),
  preparation: aiPreparationSchema.nullable().optional(),
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
