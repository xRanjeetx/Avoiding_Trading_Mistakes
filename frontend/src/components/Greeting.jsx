import { Icon } from "./ui.jsx";

function greetingFor(hour, name) {
  const who = name ? `, ${name}` : "";
  if (hour < 5) return `Up late${who}?`;
  if (hour < 12) return `Good morning${who}`;
  if (hour < 18) return `Good afternoon${who}`;
  return `Good evening${who}`;
}

// First name from the login address; the address itself is never shown.
function firstName(email) {
  const raw = (email || "").split("@")[0].split(/[._\-+0-9]/)[0];
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : "";
}

export default function Greeting({ email, now = new Date() }) {
  return (
    <div className="greeting">
      <Icon name="sun" size={16} />
      <span>{greetingFor(now.getHours(), firstName(email))}</span>
    </div>
  );
}
