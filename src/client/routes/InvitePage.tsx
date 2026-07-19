import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { UserPlus } from "lucide-react";
import { useAuth } from "../state/AuthContext";
import { api, ApiError } from "../api/client";
import AuthPage from "./AuthPage";

export default function InvitePage() {
  const { token = "" } = useParams();
  const { user } = useAuth();
  const [inviter, setInviter] = useState("A friend");
  const [status, setStatus] = useState<"loading" | "ready" | "connected" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.get<{ invite: { inviterDisplayName: string } }>(`/friends/invites/${token}`)
      .then((data) => { if (active) { setInviter(data.invite.inviterDisplayName); setStatus("ready"); } })
      .catch((err) => { if (active) { setError(err instanceof ApiError ? err.message : "This invite is unavailable."); setStatus("error"); } });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (!user || status !== "ready" || !token) return;
    api.post<{ friendship: { inviterDisplayName: string } }>(`/friends/invites/${token}/accept`)
      .then((data) => { setInviter(data.friendship.inviterDisplayName); setStatus("connected"); })
      .catch((err) => { setError(err instanceof ApiError ? err.message : "Couldn't accept this invite."); setStatus("error"); });
  }, [user, token, status]);

  if (!user) {
    return (
      <div className="invite-landing">
        <div className="invite-hero"><div className="invite-card__icon"><UserPlus size={26} /></div><div><div className="eyebrow">Plan together</div><h1>{status === "loading" ? "Opening your invite…" : `${inviter} invited you to PlanBuddy.`}</h1><p>Connect once, then group suggestions can respect both people's tastes and verified constraints—without sharing private memory.</p>{error && <div className="error-banner">{error}</div>}</div></div>
        {status !== "error" && <AuthPage />}
      </div>
    );
  }

  return (
    <div className="centered-page">
      <div className="auth-card invite-result">
        <div className="invite-card__icon"><UserPlus size={26} /></div>
        <div className="eyebrow">Friend invite</div>
        {status === "connected" ? <><h1>You're connected with {inviter}.</h1><p>Select {inviter} under “Who's in” whenever you're planning together.</p><Link className="btn btn-primary btn-block" to={user.homeBaseLabel ? "/plan" : "/onboarding"}>{user.homeBaseLabel ? "Plan together" : "Finish setup"}</Link></> : status === "error" ? <><h1>This invite is unavailable.</h1><div className="error-banner">{error ?? "It may have expired or already been used."}</div><Link className="btn btn-secondary btn-block" to={user.homeBaseLabel ? "/friends" : "/onboarding"}>Continue</Link></> : <><h1>Connecting you with {inviter}…</h1><div className="skeleton" style={{ height: 14 }} /></>}
      </div>
    </div>
  );
}
