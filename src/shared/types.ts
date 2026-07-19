import type { Scale } from "./scale.js";

export type Id = string;

export interface PublicUser {
  id: Id;
  email: string;
  homeBaseLabel: string | null;
  homeBaseLat: number | null;
  homeBaseLng: number | null;
  createdAt: string;
}

export type ParticipantKind = "person" | "pet";

export interface Participant {
  id: Id;
  userId: Id;
  name: string;
  kind: ParticipantKind;
  relationship: string | null;
  isOwner: boolean;
  createdAt: string;
}

export type ConstraintStatus = "verified" | "active_unverified";
export type ConstraintSource = "typed" | "chat";

export interface Constraint {
  id: Id;
  userId: Id;
  participantId: Id | null; // null = household-scoped
  text: string;
  status: ConstraintStatus;
  source: ConstraintSource;
  sourceQuote: string | null;
  sourceMessageId: Id | null;
  createdAt: string;
  updatedAt: string;
}

export type TastePolarity = "love" | "avoid";
export type TasteSource = "stated" | "onboarding" | "promoted";

export interface Taste {
  id: Id;
  userId: Id;
  participantId: Id | null;
  text: string;
  polarity: TastePolarity;
  weight: number;
  source: TasteSource;
  createdAt: string;
  updatedAt: string;
}

export type HunchStatus = "active" | "dismissed" | "promoted";

export interface Hunch {
  id: Id;
  userId: Id;
  participantId: Id | null;
  text: string;
  polarity: TastePolarity;
  confidence: number;
  evidenceCount: number;
  plansSinceEvidence: number;
  lastEvidenceAt: string | null;
  decayAt: string;
  status: HunchStatus;
  createdAt: string;
  updatedAt: string;
}

export interface HunchEvidence {
  id: Id;
  hunchId: Id;
  planId: Id | null;
  sessionId: Id | null;
  note: string;
  createdAt: string;
}

export type ChatSessionStatus = "open" | "ended";

export interface ChatSession {
  id: Id;
  userId: Id;
  status: ChatSessionStatus;
  createdAt: string;
  endedAt: string | null;
  messageCount: number;
}

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: Id;
  sessionId: Id;
  role: ChatRole;
  content: string;
  createdAt: string;
}

export interface PlanSpec {
  id: Id;
  userId: Id;
  parentSpecId: Id | null;
  version: number;
  scale: Scale;
  startDate: string;
  endDate: string;
  radiusKm: number;
  moodContext: string | null;
  participantIds: Id[];
  generationCount: number;
  createdAt: string;
}

export interface Beat {
  title: string;
  description: string;
  category: string;
  indoor: boolean;
}

export interface Citation {
  factId: string;
  quote: string;
  source: string;
}

export interface ScoreBreakdown {
  groupFit: number;
  feasibility: number;
  novelty: number;
  finalScore: number;
  perParticipantFit: Record<Id, number>;
}

export interface Candidate {
  id: Id;
  planSpecId: Id;
  title: string;
  rationale: string;
  category: string;
  indoor: boolean;
  beats: Beat[];
  destinationAnchor: string | null;
  travelEstimateKm: number | null;
  citations: Citation[];
  constraintCompliance: { constraintId: Id; satisfied: boolean }[];
  scoreBreakdown: ScoreBreakdown;
  rank: number;
  rejected: boolean;
  rejectionReason: string | null;
  createdAt: string;
}

export type PlanStatus = "locked" | "rejected";

export interface WeatherSnapshot {
  temperatureC: number | null;
  precipitationProbability: number | null;
  summary: string;
  unavailable: boolean;
}

export interface PlanRecord {
  id: Id;
  userId: Id;
  planSpecId: Id;
  candidateId: Id;
  status: PlanStatus;
  title: string;
  rationale: string;
  category: string;
  eventStartDate: string;
  eventEndDate: string;
  beats: Beat[];
  weather: WeatherSnapshot | null;
  distanceKm: number | null;
  placeProvenance: { mode: "inspiration" | "resolved"; note: string };
  activeConstraints: { id: Id; text: string; status: ConstraintStatus }[];
  citations: Citation[];
  rejectionReason: string | null;
  lockedAt: string | null;
  createdAt: string;
}

export interface Feedback {
  id: Id;
  planId: Id;
  rating: number;
  comment: string | null;
  createdAt: string;
}

export interface Extraction {
  participantName: string | null;
  kind: "constraint" | "taste";
  text: string;
  quote: string | null;
  quoteStart: number | null;
  quoteEnd: number | null;
  polarity: TastePolarity | null;
  confidence: number;
}
