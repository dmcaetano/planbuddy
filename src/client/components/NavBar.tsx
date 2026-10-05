import { NavLink, useLocation } from "react-router-dom";
import { CalendarHeart, MessageCircle, BrainCircuit, History } from "lucide-react";

const TABS = [
  { to: "/", label: "Plan", icon: CalendarHeart },
  { to: "/chat", label: "Chat", icon: MessageCircle },
  { to: "/memory", label: "Memory", icon: BrainCircuit },
  { to: "/history", label: "History", icon: History },
];

export default function NavBar() {
  const { pathname } = useLocation();
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {TABS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          className={({ isActive }) => (isActive || (to === "/" && pathname === "/plan/custom") ? "active" : "")}
        >
          <Icon size={22} strokeWidth={2} aria-hidden="true" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
