export type {
  PublicUser,
  Participant,
  ParticipantKind,
  Constraint,
  ConstraintStatus,
  Taste,
  TastePolarity,
  Hunch,
  HunchEvidence,
  ChatSession,
  ChatMessage,
  PlanChatMessage,
  PlanSpec,
  Candidate,
  Beat,
  Citation,
  PlanRecord,
  Feedback,
  Reaction,
  FeatureSummary,
  CandidateReaction,
  Friend,
  WeatherSnapshot,
} from "@shared/types";
export type { Scale } from "@shared/scale";

import type { Candidate, WeatherSnapshot, PlanSpec, Friend } from "@shared/types";

export interface PlanView {
  candidate: Candidate;
  weather: WeatherSnapshot;
  placeProvenance: { mode: "inspiration" | "resolved"; note: string };
  activeConstraints: { id: string; text: string; status: string }[];
}

export interface PipelineResponse {
  spec: PlanSpec;
  aiMode: "deepseek" | "gemini-grounded" | "demo";
  deadEnd: boolean;
  deadEndReasons: string[];
  winner: PlanView | null;
  alternates: PlanView[];
  generationsUsed: number;
  generationsRemaining: number;
  looseners?: string[];
}

export interface FriendLabel {
  id: string;
  name: string;
}

export interface FriendWithLabels extends Friend {
  labels: FriendLabel[];
}

export interface FriendLabelSummary {
  id: string;
  name: string;
  memberCount: number;
  friendUserIds: string[];
}

export interface BlockedFriend {
  userId: string;
  email: string;
  displayName: string;
  blockedAt: string;
}
