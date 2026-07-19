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
  PlanSpec,
  Candidate,
  Beat,
  Citation,
  PlanRecord,
  Feedback,
  WeatherSnapshot,
} from "@shared/types";
export type { Scale } from "@shared/scale";

import type { Candidate, WeatherSnapshot, PlanSpec } from "@shared/types";

export interface PlanView {
  candidate: Candidate;
  weather: WeatherSnapshot;
  placeProvenance: { mode: "inspiration" | "resolved"; note: string };
  activeConstraints: { id: string; text: string; status: string }[];
}

export interface PipelineResponse {
  spec: PlanSpec;
  aiMode: "deepseek" | "demo";
  deadEnd: boolean;
  deadEndReasons: string[];
  winner: PlanView | null;
  alternates: PlanView[];
  generationsUsed: number;
  generationsRemaining: number;
  looseners?: string[];
}
