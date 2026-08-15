import type { LucideIcon } from "lucide-react";

interface Props {
  icon: LucideIcon;
  title: string;
  detail: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, detail, action }: Props) {
  return (
    <div className="empty-state">
      <Icon size={28} strokeWidth={1.5} />
      <strong>{title}</strong>
      <span>{detail}</span>
      {action}
    </div>
  );
}
