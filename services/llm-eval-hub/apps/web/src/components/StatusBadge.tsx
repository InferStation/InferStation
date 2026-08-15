interface Props {
  status: string;
}

export function StatusBadge({ status }: Props) {
  const normalized = status.toLowerCase();
  return <span className={`status status-${normalized}`}>{status.replaceAll("_", " ")}</span>;
}
