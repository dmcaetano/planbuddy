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
  isFriendAccount?: boolean;
  accountEmail?: string | null;
  createdAt: string;
}

export type Reaction = "dislike" | "like" | "love";

export interface FeatureSummary {
  summary: string;
  features: string[];
}

export interface CandidateReaction {
  id: Id;
  userId: Id;
  candidateId: Id;
  reaction: Reaction;
  featureSummary: string | null;
  features: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Friend {
  userId: Id;
  email: string;
  displayName: string;
  participant: Participant;
  connectedAt: string;
}

export type ConstraintStatus = "verified" | "active_unverified";
export type ConstraintSource = "typed" | "chat" | "onboarding_quiz";

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
export type TasteSource = "stated" | "onboarding" | "promoted" | "onboarding_quiz";

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
  startTime?: string | null;
  durationMinutes?: number | null;
  travelMode?: "walking" | "driving" | "transit" | "ferry" | null;
  distanceFromPreviousKm?: number | null;
  travelMinutes?: number | null;
  place?: PlanPlace | null;
  directionsUrl?: string | null;
}

export interface PlanChatMessage {
  id: Id;
  userId: Id;
  planSpecId: Id;
  candidateId: Id | null;
  role: "user" | "assistant";
  content: string;
  action: Record<string, unknown> | null;
  createdAt: string;
}

export interface PlanPlace {
  name: string;
  address?: string | null;
  kind: string;
  sourceUrl: string;
  sourceLabel: string;
  factualNote: string;
  mapsUrl?: string | null;
}

export interface PlanImage {
  url: string;
  sourceUrl: string;
  attribution: string;
  caption: string;
}

export interface PreparationGuide {
  wear: string[];
  bring: string[];
  pet: string[];
  weatherRule: string;
}

export interface PlanFallback {
  title: string;
  description: string;
  place?: PlanPlace | null;
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
  walkingDistanceKm: number | null;
  walkingMinutes: number | null;
  estimatedCost: string | null;
  checkBeforeYouGo: string[];
  fallback: PlanFallback | null;
  photoSearchTerm: string | null;
  heroImage: PlanImage | null;
  routeMapsUrl: string | null;
  preparation: PreparationGuide | null;
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

export type PlanStatus = "suggested" | "locked" | "rejected";

export interface WeatherSnapshot {
  temperatureC: number | null;
  temperatureMinC?: number | null;
  apparentTemperatureC?: number | null;
  precipitationProbability: number | null;
  windSpeedKph?: number | null;
  uvIndex?: number | null;
  sunrise?: string | null;
  sunset?: string | null;
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
  reaction: Reaction;
  comment: string | null;
  featureSummary: string | null;
  features: string[];
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
