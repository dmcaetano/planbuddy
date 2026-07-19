import { NavLink } from "react-router-dom";
import { CalendarHeart, MessageCircle, BrainCircuit, History } from "lucide-react";

const TABS = [
  { to: "/plan", label: "Plan", icon: CalendarHeart },
  { to: "/chat", label: "Chat", icon: MessageCircle },
  { to: "/memory", label: "Memory", icon: BrainCircuit },
  { to: "/history", label: "History", icon: History },
];

export default function NavBar() {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {TABS.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "active" : "")}>
          <Icon size={22} strokeWidth={2} aria-hidden="true" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
